require('dotenv').config();

const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const { ClobClient } = require('@polymarket/clob-client-v2');
const { Wallet, providers } = require('ethers');
const { refreshLiquidMarkets } = require('./marketScanner');

const JsonRpcProvider = providers.JsonRpcProvider;

const app = express();
const PORT = process.env.PORT || 3000;

const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AUTO_TRADE_INTERVAL = 60 * 1000;
const COOLDOWN_TIME = 5 * 60 * 1000;
const MAX_BET_PERCENT = 0.25;
const TAKE_PROFIT_PERCENT = 0.15;
const STOP_LOSS_PERCENT = 0.08;

app.use(express.json());

let isBotActive = true;
let lastTradeTimestamp = 0;
let currentBalance = 70.00;
let currentBetSize = 0.50;      // Ставка $0.50
let currentMainPrice = 0.70;
let currentHedgeUpPrice = 0.005;
let currentHedgeDownPrice = 0.005;

let clobClient;
try {
    if (process.env.POLYMARKET_PRIVATE_KEY) {
        const provider = new JsonRpcProvider("https://polygon-rpc.com");
        const wallet = new Wallet(process.env.POLYMARKET_PRIVATE_KEY, provider);
        clobClient = new ClobClient({
            host: "https://clob.polymarket.com",
            chainId: 137,
            signer: wallet,
            apiKey: process.env.CLOB_API_KEY,
            apiSecret: process.env.CLOB_SECRET,
            apiPassphrase: process.env.CLOB_PASS_PHRASE
        });
        console.log("✅ CLOB V2 Client ready (Polygon)");
    } else {
        console.warn("⚠️ POLYMARKET_PRIVATE_KEY not found");
    }
} catch (e) { console.error("❌ CLOB init error:", e.message); }

// Firebase initialization – ако няма конфигурация, просто продължаваме без Firebase
let db = null;
if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        db = admin.firestore();
        console.log("✅ Firebase connected");
    } catch (error) { 
        console.error("❌ Firebase error:", error.message);
        console.log("⚠️ Продължавам без Firebase (без TP/SL)");
    }
} else {
    console.log("ℹ️ Firebase не е конфигуриран – TP/SL няма да работят");
}

async function sendToTelegram(message) {
    if (!TG_TOKEN || !TG_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            chat_id: TG_CHAT_ID,
            text: `🛡️ HyperMeteo\n${message}`,
            parse_mode: 'HTML'
        });
    } catch (e) { console.log("Telegram error"); }
}

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

async function executeTrade() {
    if (!isBotActive) return { success: false, error: "Bot disabled" };
    if (Date.now() - lastTradeTimestamp < COOLDOWN_TIME) return { success: false, error: "Cooldown" };
    if (!clobClient) return { success: false, error: "No CLOB client" };

    const marketData = await refreshLiquidMarkets();
    if (!marketData?.success) {
        return { success: false, error: marketData?.error || "No market" };
    }

    let betAmount = Math.min(currentBetSize, currentBalance * MAX_BET_PERCENT);
    if (betAmount < 0.5) return { success: false, error: "Balance too low" };

    const hedgeCalc = calculateDoubleHedging(
        betAmount,
        marketData.prices.main,
        marketData.prices.hedgeUp,
        marketData.prices.hedgeDown
    );

    try {
        if (marketData.tokens[0]) {
            await clobClient.createOrder({
                tokenID: marketData.tokens[0],
                price: marketData.prices.main,
                side: "BUY",
                size: hedgeCalc.main.shares
            });
            if (db) await db.collection('positions').add({
                tokenId: marketData.tokens[0],
                type: "main",
                avgPrice: marketData.prices.main,
                shares: hedgeCalc.main.shares,
                side: "BUY",
                closed: false,
                date: new Date()
            });
        }
        if (marketData.tokens[1]) {
            await clobClient.createOrder({
                tokenID: marketData.tokens[1],
                price: marketData.prices.hedgeUp,
                side: "BUY",
                size: hedgeCalc.hedgeUp.shares
            });
            if (db) await db.collection('positions').add({
                tokenId: marketData.tokens[1],
                type: "hedgeUp",
                avgPrice: marketData.prices.hedgeUp,
                shares: hedgeCalc.hedgeUp.shares,
                side: "BUY",
                closed: false,
                date: new Date()
            });
        }
        if (marketData.tokens[2]) {
            await clobClient.createOrder({
                tokenID: marketData.tokens[2],
                price: marketData.prices.hedgeDown,
                side: "BUY",
                size: hedgeCalc.hedgeDown.shares
            });
            if (db) await db.collection('positions').add({
                tokenId: marketData.tokens[2],
                type: "hedgeDown",
                avgPrice: marketData.prices.hedgeDown,
                shares: hedgeCalc.hedgeDown.shares,
                side: "BUY",
                closed: false,
                date: new Date()
            });
        }

        lastTradeTimestamp = Date.now();
        currentBalance -= betAmount;
        if (db) await db.collection('stats').doc('main').set({ balance: currentBalance, lastUpdate: new Date() });

        await sendToTelegram(`✅ Сделка ${betAmount} USDC\n${marketData.title}\nMain: ${marketData.prices.main}\nHedge: ${marketData.prices.hedgeUp}/${marketData.prices.hedgeDown}`);
        return { success: true, prices: marketData.prices };
    } catch (err) {
        console.error("Trade error:", err.message);
        return { success: false, error: err.message };
    }
}

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

app.get('/api/status', async (req, res) => {
    res.json({
        botEnabled: isBotActive,
        balance: currentBalance.toFixed(2),
        activePositions: db ? (await db.collection('positions').where('closed', '==', false).get()).size : 0
    });
});

app.post('/api/bot/toggle', async (req, res) => {
    isBotActive = !isBotActive;
    await sendToTelegram(isBotActive ? "🤖 Ботът е АКТИВЕН 24/7" : "⛔ Ботът е СПРЯН");
    res.json({ success: true, botEnabled: isBotActive });
});

app.get('/get-settings', (req, res) => {
    res.json({
        balance: currentBalance.toFixed(2),
        betSize: currentBetSize.toFixed(2),
        mainPrice: currentMainPrice.toFixed(2),
        hedgeUpPrice: currentHedgeUpPrice.toFixed(3),
        hedgeDownPrice: currentHedgeDownPrice.toFixed(3)
    });
});

app.post('/update-settings', (req, res) => {
    if (req.body.balance !== undefined) currentBalance = parseFloat(req.body.balance);
    if (req.body.betSize !== undefined) currentBetSize = parseFloat(req.body.betSize);
    res.json({ success: true });
});

app.post('/execute-trade', async (req, res) => {
    const result = await executeTrade();
    res.json(result);
});

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HyperMeteo</title>
    <style>body{background:#0b0c10;color:#c5c6c7;font-family:Arial;text-align:center;padding:15px}.container{max-width:400px;margin:auto;background:#1f2833;padding:20px;border-radius:12px;border:1px solid #45f3ff}h2{color:#45f3ff}.metric-box{background:#0b0c10;padding:15px;border-radius:8px;margin-bottom:15px}.metric-value{font-size:32px;font-weight:bold;color:#fff}.execute-btn{width:100%;padding:16px;background:#00e676;color:#000;border:none;border-radius:10px;font-size:16px;font-weight:bold;cursor:pointer}.console-box{background:#000;color:#0f0;font-family:monospace;font-size:11px;padding:10px;border-radius:6px;height:75px;overflow-y:auto;margin-top:15px}</style>
    </head>
    <body>
    <div class="container"><h2>HyperMeteo V4</h2><div class="metric-box"><div class="metric-label">Баланс (USDC)</div><div class="metric-value" id="lblBalance">0.00</div></div>
    <input type="number" step="0.1" id="inBalance" placeholder="Депозит" style="width:100%;padding:10px;margin-bottom:10px;background:#0b0c10;color:#45f3ff;border:1px solid #2f3e46;border-radius:8px">
    <input type="number" step="0.1" id="inBet" placeholder="Ставка" style="width:100%;padding:10px;margin-bottom:20px;background:#0b0c10;color:#45f3ff;border:1px solid #2f3e46;border-radius:8px">
    <button class="execute-btn" onclick="trade()">ИЗПЪЛНИ ОРДЕР</button>
    <div class="console-box" id="console">>> Система готова</div></div>
    <script>
    async function load(){const r=await fetch('/get-settings'),d=await r.json();document.getElementById('lblBalance').innerText=d.balance;document.getElementById('inBalance').value=d.balance;document.getElementById('inBet').value=d.betSize}
    async function trade(){log("Ръчна сделка...");const r=await fetch('/execute-trade',{method:'POST'}),d=await r.json();log(d.success?"✅ Успех":"❌ "+d.error);load()}
    function log(m){const c=document.getElementById('console');c.innerHTML+=\`<br>[\${new Date().toLocaleTimeString()}] \${m}\`;c.scrollTop=c.scrollHeight}
    setInterval(load,5000);window.onload=load;
    </script></body></html>`);
});

app.listen(PORT, () => console.log(`🚀 HyperMeteo 24/7 работи на порт ${PORT}`));
