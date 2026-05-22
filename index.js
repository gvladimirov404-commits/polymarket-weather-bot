const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const { ClobClient } = require('@polymarket/clob-client');
const { Wallet } = require('ethers');
const { refreshLiquidMarkets } = require('./marketScanner');

const app = express();
const PORT = process.env.PORT || 3000;

const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

app.use(express.json());

// ГЛОБАЛНИ СИСТЕМНИ НАСТРОЙКИ
let isBotActive = true;          
let lastTradeTimestamp = 0;      
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 минути защита против зацикляне

let currentBalance = 70.00; 
let currentBetSize = 1.00;  
let currentMainPrice = 0.70;
let currentHedgeUpPrice = 0.005;
let currentHedgeDownPrice = 0.005;

// ИНИЦИАЛИЗАЦИЯ НА POLYMARKET CLOB КЛИЕНТ
let clobClient;
try {
    if (process.env.POLYMARKET_PRIVATE_KEY) {
        const wallet = new Wallet(process.env.POLYMARKET_PRIVATE_KEY);
        clobClient = new ClobClient({
            signer: wallet,
            apiKey: process.env.POLYMARKET_API_KEY,
            apiSecret: process.env.POLYMARKET_API_SECRET,
            apiPassphrase: process.env.POLYMARKET_API_PASSPHRASE,
            host: "https://clob.polymarket.com"
        });
        console.log("🛡️ Polymarket CLOB Client зареден успешно.");
    }
} catch (e) {
    console.error("Грешка при инициализация на Polymarket Client:", e.message);
}

// ИНИЦИАЛИЗАЦИЯ НА FIREBASE
if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (error) { console.error("Firebase грешка:", error.message); }
}

// МАТЕМАТИКА ЗА DOUBLE HEDGING
function calculateDoubleHedging(totalBet, mainPrice, hedgeUpPrice, hedgeDownPrice) {
    const mainBudget = totalBet * 0.70;      
    const hedgeUpBudget = totalBet * 0.15;   
    const hedgeDownBudget = totalBet * 0.15; 
    
    const mainShares = Math.floor(mainBudget / mainPrice);
    const hedgeUpShares = Math.floor(hedgeUpBudget / hedgeUpPrice);
    const hedgeDownShares = Math.floor(hedgeDownBudget / hedgeDownPrice);

    return {
        main: { budget: mainBudget, price: mainPrice, shares: mainShares },
        hedgeUp: { budget: hedgeUpBudget, price: hedgeUpPrice, shares: hedgeUpShares },
        hedgeDown: { budget: hedgeDownBudget, price: hedgeDownPrice, shares: hedgeDownShares }
    };
}

// TELEGRAM ИЗВЕСТИЯ
async function sendToTelegram(message) {
    if (!TG_TOKEN || !TG_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            chat_id: TG_CHAT_ID,
            text: `🛡️ <b>HyperMeteo Fortress Engine</b>\n${message}`,
            parse_mode: 'HTML'
        });
    } catch (e) { console.log("Грешка при връзка с Telegram API."); }
}

// API ЕНДПОЙНТИ ЗА ИНТЕРФЕЙСА
app.get('/get-settings', async (req, res) => {
    res.json({ 
        balance: currentBalance.toFixed(2), betSize: currentBetSize.toFixed(2),
        mainPrice: currentMainPrice.toFixed(2), hedgeUpPrice: currentHedgeUpPrice.toFixed(3), hedgeDownPrice: currentHedgeDownPrice.toFixed(3),
        botStatus: isBotActive ? "ACTIVE" : "KILLED"
    });
});

app.post('/update-settings', async (req, res) => {
    const { balance, betSize, mainPrice, hedgeUpPrice, hedgeDownPrice } = req.body;
    if (balance !== undefined) currentBalance = parseFloat(balance);
    if (betSize !== undefined) currentBetSize = parseFloat(betSize);
    if (mainPrice !== undefined) currentMainPrice = parseFloat(mainPrice);
    if (hedgeUpPrice !== undefined) currentHedgeUpPrice = parseFloat(hedgeUpPrice);
    if (hedgeDownPrice !== undefined) currentHedgeDownPrice = parseFloat(hedgeDownPrice);
    res.json({ success: true, balance: currentBalance, betSize: currentBetSize });
});

// ИЗПЪЛНЕНИЕ НА АВТОМАТИЧЕН ИСТИНСКИ ОРДЕР С ЖИВИ ЦЕНИ
app.post('/execute-trade', async (req, res) => {
    if (!isBotActive) return res.status(403).json({ success: false, error: "БОТЪТ Е ИЗКЛЮЧЕН!" });

    const now = Date.now();
    if (now - lastTradeTimestamp < COOLDOWN_TIME) {
        const remainingMins = Math.ceil((COOLDOWN_TIME - (now - lastTradeTimestamp)) / 60000);
        return res.status(429).json({ success: false, error: `Защита! Изчакай ${remainingMins} мин.` });
    }

    if (!clobClient) return res.status(500).json({ success: false, error: "Липсват Polymarket API ключове на сървъра!" });

    // 1. Скенерът влиза в действие и взима живите данни
    const marketData = await refreshLiquidMarkets();
    if (!marketData || !marketData.success) {
        return res.status(404).json({ success: false, error: "Не бе намерен активен метео пазар в Polymarket!" });
    }

    const liveMainPrice = marketData.prices.main;
    const liveHedgeUpPrice = marketData.prices.hedgeUp;
    const liveHedgeDownPrice = marketData.prices.hedgeDown;

    // Смятаме застраховката по цените от настоящата секунда
    const hedgeCalc = calculateDoubleHedging(currentBetSize, liveMainPrice, liveHedgeUpPrice, liveHedgeDownPrice);

    try {
        // 2. ИЗПРАЩАНЕ НА ОРДЕРИТЕ КЪМ КНИГАТА НА POLYMARKET (CLOB)
        
        // Ордер 1: Център
        if(marketData.tokens[0]) {
            await clobClient.createOrder({
                tokenID: marketData.tokens[0],
                price: liveMainPrice,
                side: "BUY",
                size: hedgeCalc.main.shares
            });
        }

        // Ордер 2: Жега
        if(marketData.tokens[1]) {
            await clobClient.createOrder({
                tokenID: marketData.tokens[1],
                price: liveHedgeUpPrice,
                side: "BUY",
                size: hedgeCalc.hedgeUp.shares
            });
        }

        // Ордер 3: Студ
        if(marketData.tokens[2]) {
            await clobClient.createOrder({
                tokenID: marketData.tokens[2],
                price: liveHedgeDownPrice,
                side: "BUY",
                size: hedgeCalc.hedgeDown.shares
            });
        }

        lastTradeTimestamp = now;

        // Синхронизираме цените на уеб панела, за да ги виждаш реално
        currentMainPrice = liveMainPrice;
        currentHedgeUpPrice = liveHedgeUpPrice;
        currentHedgeDownPrice = liveHedgeDownPrice;

        const alertMsg = `
✅ <b>ДИНАМИЧНА СДЕЛКА ИЗПЪЛНЕНА НА ЖИВО</b>
<b>Пазар:</b> ${marketData.title}
<b>Разпределен Риск:</b> $${currentBetSize.toFixed(2)} USDC
📊 <b>Цени от пазара в реално време:</b>
• Център: ${liveMainPrice.toFixed(2)}
• Жега: ${liveHedgeUpPrice.toFixed(3)}
• Студ: ${liveHedgeDownPrice.toFixed(3)}
🛡️ <i>Защитата преизчисли математиката автоматично!</i>`;

        await sendToTelegram(alertMsg);
        return res.json({ success: true, prices: marketData.prices });

    } catch (tradeError) {
        console.error("Грешка при пускане на поръчка:", tradeError.message);
        return res.status(500).json({ success: false, error: `Грешка Polymarket API: ${tradeError.message}` });
    }
});

// ГРАФИЧЕН ИНТЕРФЕЙС (HTML ПАНЕЛ ЗА ТЕЛЕФОН)
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
            <h2>HyperMeteo Fortress V3.2</h2>
            <div class="shield-badge">4X SHIELD ACTIVE</div>
            
            <div class="metric-box">
                <div class="metric-label">Работен Капитал (USDC)</div>
                <div class="metric-value" id="lblBalance">0.00</div>
            </div>

            <button class="status-btn" id="btnStatus">🚨 БОТЪТ РАБОТИ (Кликни за спиране)</button>

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

            <div class="console-box" id="console">>> Система в готовност. Извличане на живи цени...</div>
        </div>

        <script>
            function log(msg) {
                const con = document.getElementById('console');
                const time = new Date().toLocaleTimeString();
                con.innerHTML += \`<br>[\${time}] \${msg}\`;
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
                } catch(e) { log("Грешка при зареждане на настройките."); }
            }

            async function saveSettings() {
                const bal = document.getElementById('inBalance').value;
                const bet = document.getElementById('inBet').value;
                try {
                    await fetch('/update-settings', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ balance: bal, betSize: bet })
                    });
                    document.getElementById('lblBalance').innerText = parseFloat(bal).toFixed(2);
                    log("Параметрите са записани.");
                } catch(e) { log("Грешка при запис."); }
            }

            async function triggerTrade() {
                log("Проверка на пазара и извличане на живи цени...");
                try {
                    const res = await fetch('/execute-trade', { method: 'POST' });
                    const data = await res.json();
                    if(data.success) {
                        log("УСПЕХ: Ордерите по живи цени са пуснати!");
                        loadSettings(); // Презарежда новите цени на екрана
                    } else {
                        log("ГРЕШКА: " + data.error);
                    }
                } catch(e) { log("Срив при комуникация със сървъра."); }
            }

            setInterval(loadSettings, 10000); // Опреснява цените на всеки 10 секунди
            window.onload = loadSettings;
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log(`HyperMeteo Trading Engine Active on port ${PORT}`));
