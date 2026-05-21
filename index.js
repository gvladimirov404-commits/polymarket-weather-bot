const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const { ClobClient } = require('@polymarket/clob-client');
const { Wallet } = require('ethers');
const { refreshLiquidMarkets } = require('./marketScanner'); // Връзка със сканера

const app = express();
const PORT = process.env.PORT || 3000;

const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

app.use(express.json());

// ГЛОБАЛНИ СИСТЕМНИ ЩИТОВЕ
let isBotActive = true;          
let lastTradeTimestamp = 0;      
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 минути защита

let currentBalance = 70.00; 
let currentBetSize = 10.00;  
let currentMainPrice = 0.70;
let currentHedgeUpPrice = 0.005;
let currentHedgeDownPrice = 0.005;

// Инициализация на Polymarket CLOB клиента с твоите системни ключове
let clobClient;
try {
    if (process.env.POLYMARKET_PRIVATE_KEY) {
        const wallet = new Wallet(process.env.POLYMARKET_PRIVATE_KEY);
        clobClient = new ClobClient({
            signer: wallet,
            apiKey: process.env.POLYMARKET_API_KEY,
            apiSecret: process.env.POLYMARKET_API_SECRET,
            apiPassphrase: process.env.POLYMARKET_API_PASSPHRASE,
            host: "https://clob.polymarket.com" // Основната търговска мрежа
        });
        console.log("🛡️ Polymarket CLOB Client зареден успешно.");
    }
} catch (e) {
    console.error("Грешка при инициализация на Polymarket Client:", e.message);
}

// Firebase инициализация
if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (error) { console.error("Firebase грешка:", error.message); }
}

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

// ПАНЕЛ РЕЖИМ (ФУНКЦИИТЕ GET И UPDATE СЕ ЗАПАЗВАТ)
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

// ИСТИНСКОТО ИЗПЪЛНЕНИЕ НА СДЕЛКАТА (ВАРИАНТ А + Б)
app.post('/execute-trade', async (req, res) => {
    if (!isBotActive) return res.status(403).json({ success: false, error: "БОТЪТ Е ИЗКЛЮЧЕН!" });

    const now = Date.now();
    if (now - lastTradeTimestamp < COOLDOWN_TIME) {
        const remainingMins = Math.ceil((COOLDOWN_TIME - (now - lastTradeTimestamp)) / 60000);
        return res.status(429).json({ success: false, error: `Защита! Изчакай ${remainingMins} мин.` });
    }

    if (!clobClient) return res.status(500).json({ success: false, error: "Липсват Polymarket API ключове на сървъра!" });

    // 1. Извикваме автоматичния сканер да намери пазара и неговите Token ID-та
    const marketData = await refreshLiquidMarkets();
    if (!marketData || !marketData.success) {
        return res.status(404).json({ success: false, error: "Не бе намерен активен метео пазар в Polymarket!" });
    }

    // Изчисляваме разпределението по математиката за Double Hedging
    const hedgeCalc = calculateDoubleHedging(currentBetSize, currentMainPrice, currentHedgeUpPrice, currentHedgeDownPrice);

    try {
        // 2. ИЗПЪЛНЕНИЕ НА ОРДЕРИТЕ КЪМ POLYMARKET (Пускат се като GTC Лимитирани поръчки)
        // Забележка: marketData.tokens[0], [1], [2] съответстват на различните изходи от пазара
        
        // Ордер 1: Център
        if(marketData.tokens[0]) {
            await clobClient.createOrder({
                tokenID: marketData.tokens[0],
                price: currentMainPrice,
                side: "BUY",
                size: hedgeCalc.main.shares
            });
        }

        // Ордер 2: Жега (Hedge Up)
        if(marketData.tokens[1]) {
            await clobClient.createOrder({
                tokenID: marketData.tokens[1],
                price: currentHedgeUpPrice,
                side: "BUY",
                size: hedgeCalc.hedgeUp.shares
            });
        }

        // Ордер 3: Студ (Hedge Down)
        if(marketData.tokens[2]) {
            await clobClient.createOrder({
                tokenID: marketData.tokens[2],
                price: currentHedgeDownPrice,
                side: "BUY",
                size: hedgeCalc.hedgeDown.shares
            });
        }

        lastTradeTimestamp = now;

        const alertMsg = `
✅ <b>ИСТИНСКА СДЕЛКА ИЗПЪЛНЕНА НА ПАЗАРА</b>
<b>Пазар:</b> ${marketData.title}
<b>Разпределен Риск:</b> $${currentBetSize.toFixed(2)} USDC
📊 <i>Ордерите са изпратени автоматично към Polymarket CLOB.</i>`;

        await sendToTelegram(alertMsg);
        return res.json({ success: true });

    } catch (tradeError) {
        console.error("Грешка при пускане на поръчка:", tradeError.message);
        return res.status(500).json({ success: false, error: `Грешка Polymarket API: ${tradeError.message}` });
    }
});

// Зареждане на HTML интерфейса
app.get('/', (req, res) => {
    // Връща HTML панела (остава същия като преди)
    res.send(`...`); 
});

app.listen(PORT, () => console.log(`HyperMeteo Trading Engine Active`));
