require('dotenv').config();

const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const { ClobClient } = require('@polymarket/clob-client-v2');
const { Wallet } = require('ethers');
const { refreshLiquidMarkets } = require('./marketScanner');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIG ====================
const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MIN_LIQUIDITY = 5000;        // минимална ликвидност в USD
const AUTO_TRADE_INTERVAL = 60 * 1000;  // 1 минута
const COOLDOWN_TIME = 5 * 60 * 1000;
const MAX_BET_PERCENT = 0.25;       // макс 25% от баланса на сделка
const TAKE_PROFIT_PERCENT = 0.15;   // 15% печалба
const STOP_LOSS_PERCENT = 0.08;     // 8% загуба

app.use(express.json());

// ==================== ГЛОБАЛНИ СЪСТОЯНИЯ ====================
let isBotActive = true;
let lastTradeTimestamp = 0;
let currentBalance = 70.00;
let currentBetSize = 1.00;
let currentMainPrice = 0.70;
let currentHedgeUpPrice = 0.005;
let currentHedgeDownPrice = 0.005;
let balanceHistory = [{ date: new Date(), balance: currentBalance }];
let dailyPnL = 0;
let lastDayStartBalance = currentBalance;

// ==================== POLYMARKET CLOB V2 ====================
let clobClient;
try {
    if (process.env.POLYMARKET_PRIVATE_KEY) {
        const wallet = new Wallet(process.env.POLYMARKET_PRIVATE_KEY);
        clobClient = new ClobClient({
            host: "https://clob.polymarket.com",
            chainId: 137,
            signer: wallet,
            apiKey: process.env.CLOB_API_KEY,
            apiSecret: process.env.CLOB_SECRET,
            apiPassphrase: process.env.CLOB_PASS_PHRASE
        });
        console.log("✅ Polymarket CLOB V2 Client ready");
    } else {
        console.warn("⚠️ POLYMARKET_PRIVATE_KEY not found");
    }
} catch (e) { console.error("❌ CLOB init error:", e.message); }

// ==================== FIREBASE ====================
let db = null;
if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        db = admin.firestore();
        console.log("✅ Firebase connected");
    } catch (error) { console.error("❌ Firebase error:", error.message); }
}

// ==================== HELPER: TELEGRAM ====================
async function sendToTelegram(message) {
    if (!TG_TOKEN || !TG_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            chat_id: TG_CHAT_ID,
            text: `🛡️ HyperMeteo Fortress\n${message}`,
            parse_mode: 'HTML'
        });
    } catch (e) { console.log("Telegram error"); }
}

// ==================== ХЕДЖ МАТЕМАТИКА ====================
function calculateDoubleHedging(totalBet, mainPrice, hedgeUpPrice, hedgeDownPrice) {
    const mainBudget = totalBet * 0.70;
    const hedgeUpBudget = totalBet * 0.15;
    const hedgeDownBudget = totalBet * 0.15;

    return {
        main: { budget: mainBudget, price: mainPrice, shares: Math.floor(mainBudget / mainPrice) },
        hedgeUp: { budget: hedgeUpBudget, price: hedgeUpPrice, shares: Math.floor(hedgeUpBudget / hedgeUpPrice) },
        hedgeDown: { budget: hedgeDownBudget, price: hedgeDownPrice, shares: Math.floor(hedgeDownBudget / hedgeDownPrice) }
    };
}

// ==================== ЗАТВАРЯНЕ НА ПОЗИЦИЯ ====================
async function closePosition(tokenId, shares, side) {
    if (!clobClient) return false;
    try {
        await clobClient.createOrder({
            tokenID: tokenId,
            side: side === "BUY" ? "SELL" : "BUY",
            size: shares,
            price: 0.01
        });
        return true;
    } catch (e) { return false; }
}

// ==================== АВТОМАТИЧЕН ПРОФИТ/СТОП-ЛОС ====================
async function checkAndClosePositions(currentMarketPrices) {
    if (!db) return;
    const snapshot = await db.collection('positions').where('closed', '==', false).get();
    for (const doc of snapshot.docs) {
        const pos = doc.data();
        const currentPrice = currentMarketPrices[pos.type];
        if (!currentPrice) continue;

        const pnlPercent = (currentPrice - pos.avgPrice) / pos.avgPrice;
        if (pnlPercent >= TAKE_PROFIT_PERCENT) {
            await closePosition(pos.tokenId, pos.shares, pos.side);
            await doc.ref.update({ closed: true, closePrice: currentPrice, pnl: pnlPercent });
            await sendToTelegram(`✅ Take-profit на ${pos.type} +${(pnlPercent*100).toFixed(1)}%`);
            currentBalance += pos.shares * currentPrice;
        } else if (pnlPercent <= -STOP_LOSS_PERCENT) {
            await closePosition(pos.tokenId, pos.shares, pos.side);
            await doc.ref.update({ closed: true, closePrice: currentPrice, pnl: pnlPercent });
            await sendToTelegram(`🛑 Stop-loss на ${pos.type} ${(pnlPercent*100).toFixed(1)}%`);
            currentBalance += pos.shares * currentPrice;
        }
    }
}

// ==================== ОСНОВНА ТЪРГОВСКА ФУНКЦИЯ ====================
async function executeTrade() {
    if (!isBotActive) return { success: false, error: "Bot disabled" };
    const now = Date.now();
    if (now - lastTradeTimestamp < COOLDOWN_TIME) return { success: false, error: "Cooldown" };
    if (!clobClient) return { success: false, error: "No CLOB client" };

    const marketData = await refreshLiquidMarkets();
    if (!marketData?.success || marketData.liquidity < MIN_LIQUIDITY) {
        return { success: false, error: "Low liquidity or no market" };
    }

    let availableBalance = currentBalance;
    if (db) {
        const balanceDoc = await db.collection('stats').doc('main').get();
        if (balanceDoc.exists) availableBalance = balanceDoc.data().balance;
    }
    let betAmount = Math.min(currentBetSize, availableBalance * MAX_BET_PERCENT);
    if (betAmount < 0.5) return { success: false, error: "Balance too low" };

    const liveMainPrice = marketData.prices.main;
    const liveHedgeUpPrice = marketData.prices.hedgeUp;
    const liveHedgeDownPrice = marketData.prices.hedgeDown;

    const hedgeCalc = calculateDoubleHedging(betAmount, liveMainPrice, liveHedgeUpPrice, liveHedgeDownPrice);

    try {
        if (marketData.tokens[0]) {
            await clobClient.createOrder({ tokenID: marketData.tokens[0], price: liveMainPrice, side: "BUY", size: hedgeCalc.main.shares });
            if (db) await db.collection('positions').add({ tokenId: marketData.tokens[0], type: "main", avgPrice: liveMainPrice, shares: hedgeCalc.main.shares, side: "BUY", closed: false, date: new Date() });
        }
        if (marketData.tokens[1]) {
            await clobClient.createOrder({ tokenID: marketData.tokens[1], price: liveHedgeUpPrice, side: "BUY", size: hedgeCalc.hedgeUp.shares });
            if (db) await db.collection('positions').add({ tokenId: marketData.tokens[1], type: "hedgeUp", avgPrice: liveHedgeUpPrice, shares: hedgeCalc.hedgeUp.shares, side: "BUY", closed: false, date: new Date() });
        }
        if (marketData.tokens[2]) {
            await clobClient.createOrder({ tokenID: marketData.tokens[2], price: liveHedgeDownPrice, side: "BUY", size: hedgeCalc.hedgeDown.shares });
            if (db) await db.collection('positions').add({ tokenId: marketData.tokens[2], type: "hedgeDown", avgPrice: liveHedgeDownPrice, shares: hedgeCalc.hedgeDown.shares, side: "BUY", closed: false, date: new Date() });
        }

        lastTradeTimestamp = now;
        currentMainPrice = liveMainPrice;
        currentHedgeUpPrice = liveHedgeUpPrice;
        currentHedgeDownPrice = liveHedgeDownPrice;
        currentBalance -= betAmount;
        if (db) await db.collection('stats').doc('main').set({ balance: currentBalance, lastUpdate: new Date() });

        balanceHistory.push({ date: new Date(), balance: currentBalance });
        if (balanceHistory.length > 50) balanceHistory.shift();

        const today = new Date().toDateString();
        if (lastDayStartBalance !== currentBalance && new Date(lastTradeTimestamp).toDateString() !== today) {
            dailyPnL = currentBalance - lastDayStartBalance;
            lastDayStartBalance = currentBalance;
        }

        await sendToTelegram(`✅ Авто сделка ${betAmount} USDC\nMain: ${liveMainPrice}\nHedge: ${liveHedgeUpPrice}/${liveHedgeDownPrice}`);
        return { success: true, prices: marketData.prices };
    } catch (err) {
        console.error("Trade error:", err.message);
        return { success: false, error: err.message };
    }
}

// ==================== АВТОМАТИЧЕН ЦИКЪЛ ====================
setInterval(async () => {
    if (isBotActive) {
        const result = await executeTrade();
        if (!result.success) console.log("Auto-trade skip:", result.error);
    }
}, AUTO_TRADE_INTERVAL);

setInterval(async () => {
    if (isBotActive) {
        const marketData = await refreshLiquidMarkets();
        if (marketData?.success) await checkAndClosePositions(marketData.prices);
    }
}, 30 * 1000);

// ==================== API ENDPOINTS ====================
app.get('/api/status', async (req, res) => {
    res.json({
        botEnabled: isBotActive,
        balance: currentBalance.toFixed(2),
        dailyPnL: dailyPnL.toFixed(2),
        activePositions: db ? (await db.collection('positions').where('closed', '==', false).get()).size : 0,
        balance_history: balanceHistory
    });
});

app.post('/api/bot/toggle', async (req, res) => {
    isBotActive = !isBotActive;
    await sendToTelegram(isBotActive ? "🤖 Ботът е АКТИВЕН 24/7" : "⛔ Ботът е СПРЯН");
    res.json({ success: true, botEnabled: isBotActive });
});

app.get('/get-settings', (req, res) => {
    res.json({
        balance: currentBalance.toFixed(2), betSize: currentBetSize.toFixed(2),
        mainPrice: currentMainPrice.toFixed(2), hedgeUpPrice: currentHedgeUpPrice.toFixed(3), hedgeDownPrice: currentHedgeDownPrice.toFixed(3)
    });
});

app.post('/update-settings', (req, res) => {
    const { balance, betSize } = req.body;
    if (balance !== undefined) currentBalance = parseFloat(balance);
    if (betSize !== undefined) currentBetSize = parseFloat(betSize);
    res.json({ success: true });
});

app.post('/execute-trade', async (req, res) => {
    const result = await executeTrade();
    res.json(result);
});

// ==================== HTML UI ====================
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="bg">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>HyperMeteo Engine</title>
        <style>
            body { background-color: #0b0c10; color: #c5c6c7; font-family: 'Segoe UI', Arial, sans-serif; text-align: center; padding: 15px; margin: 0; }
            .container { max-width: 400px; margin: auto; background: #1f2833; padding: 20px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); border: 1px solid #45f3ff; }
            h2 { color: #45f3ff; margin-bottom: 5px; font-size: 20px; text-transform: uppercase; letter-spacing: 1px; }
            .shield-badge { background: #0b0c10; color: #66fcf1; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: bold; border: 1px solid #66fcf1; display: inline-block; margin-bottom: 20px; }
            .metric-box { background: #0b0c10; padding: 15px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #2f3e46; }
            .metric-label { font-size: 11px; text-transform: uppercase; color: #8892b0; letter-spacing: 0.5px; }
            .metric-value { font-size: 32px; font-weight: bold; color: #ffffff; margin-top: 5px; }
            .grid-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
            .input-group { background: #0b0c10; padding: 10px; border-radius: 8px; border: 1px solid #2f3e46; text-align: left; }
            label { font-size: 10px; color: #8892b0; text-transform: uppercase; display: block; margin-bottom: 4px; }
            input { background: transparent; border: none; color: #45f3ff; font-size: 16px; font-weight: bold; width: 100%; box-sizing: border-box; outline: none; }
            .prices-title { font-size: 12px; color: #66fcf1; text-transform: uppercase; margin: 15px 0 5px 0; font-weight: bold; text-align: center; }
            .grid-prices { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 20px; }
            .price-box { background: #0b0c10; padding: 8px; border-radius: 6px; border: 1px solid #2f3e46; }
            .price-box span { font-size: 9px; color: #8892b0; display: block; text-transform: uppercase; }
            .price-box font { font-size: 14px; font-weight: bold; color: #ffffff; }
            .status-btn { width: 100%; padding: 12px; border-radius: 8px; font-weight: bold; border: 1px solid #2e7d32; background: #1b5e20; color: #fff; cursor: pointer; margin-bottom: 15px; font-size: 13px; }
            .execute-btn { width: 100%; padding: 16px; border-radius: 10px; font-size: 16px; font-weight: bold; background: #00e676; color: #000; border: none; cursor: pointer; text-transform: uppercase; box-shadow: 0 4px 10px rgba(0,230,118,0.3); transition: 0.2s; }
            .execute-btn:active { transform: scale(0.98); box-shadow: none; }
            .console-box { background: #000; color: #00ff00; font-family: monospace; font-size: 11px; padding: 10px; border-radius: 6px; text-align: left; height: 75px; overflow-y: auto; margin-top: 15px; border: 1px solid #222; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>HyperMeteo Fortress V4.0</h2>
            <div class="shield-badge">24/7 AUTO + TPSL</div>
            <div class="metric-box">
                <div class="metric-label">Работен Капитал (USDC)</div>
                <div class="metric-value" id="lblBalance">0.00</div>
            </div>
            <button class="status-btn" id="btnStatus">🟢 Ботът РАБОТИ (спри)</button>
            <div class="grid-inputs">
                <div class="input-group"><label>Депозит</label><input type="number" step="0.1" id="inBalance" onchange="saveSettings()"></div>
                <div class="input-group"><label>Ставка</label><input type="number" step="0.1" id="inBet" onchange="saveSettings()"></div>
            </div>
            <div class="prices-title">Текущи Цени на Пазара</div>
            <div class="grid-prices">
                <div class="price-box"><span>Център</span><font id="prMain">0.00</font></div>
                <div class="price-box"><span>Жега</span><font id="prUp">0.000</font></div>
                <div class="price-box"><span>Студ</span><font id="prDown">0.000</font></div>
            </div>
            <button class="execute-btn" onclick="triggerTrade()">ИЗПЪЛНИ ЗАЩИТЕН ОРДЕР</button>
            <div class="console-box" id="console">>> 24/7 режим активен. Авто-търговията работи.</div>
        </div>
        <script>
            function log(msg) {
                const con = document.getElementById('console');
                con.innerHTML += \`<br>[\${new Date().toLocaleTimeString()}] \${msg}\`;
                con.scrollTop = con.scrollHeight;
            }
            async function loadSettings() {
                try {
                    const res = await fetch('/get-settings');
                    const data = await res.json();
                    document.getElementById('lblBalance').innerText = data.balance;
                    document.getElementById('inBalance').value = data.balance;
                    document.getElementById('inBet').value = data.betSize;
                    document.getElementById('prMain').innerText = data.mainPrice;
                    document.getElementById('prUp').innerText = data.hedgeUpPrice;
                    document.getElementById('prDown').innerText = data.hedgeDownPrice;
                } catch(e) { log("Грешка при зареждане"); }
            }
            async function saveSettings() {
                const bal = document.getElementById('inBalance').value;
                const bet = document.getElementById('inBet').value;
                await fetch('/update-settings', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ balance: bal, betSize: bet }) });
                document.getElementById('lblBalance').innerText = parseFloat(bal).toFixed(2);
                log("Настройките записани");
            }
            async function triggerTrade() {
                log("Ръчна сделка...");
                const res = await fetch('/execute-trade', { method: 'POST' });
                const data = await res.json();
                log(data.success ? "✅ Сделката е пусната" : "❌ " + data.error);
                loadSettings();
            }
            let botActive = true;
            document.getElementById('btnStatus').onclick = async () => {
                const res = await fetch('/api/bot/toggle', { method: 'POST' });
                const data = await res.json();
                botActive = data.botEnabled;
                document.getElementById('btnStatus').innerText = botActive ? "🟢 Ботът РАБОТИ (спри)" : "🔴 Ботът СПРЯН (пусни)";
                log(botActive ? "Ботът е активен 24/7" : "Ботът е спрян");
            };
            setInterval(loadSettings, 5000);
            window.onload = loadSettings;
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log(`🚀 HyperMeteo 24/7 running on port ${PORT}`));
