require('dotenv').config();

const express = require('express');
const axios = require('axios');
const { ClobClient } = require('@polymarket/clob-client-v2');
const { createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { refreshLiquidMarkets } = require('./marketScanner');
const { loadOurTrades, checkAndClosePositions } = require('./positionTracker');

const app = express();
const PORT = process.env.PORT || 3000;

const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AUTO_TRADE_INTERVAL = 60 * 1000;
const COOLDOWN_TIME = 5 * 60 * 1000;
const MAX_BET_PERCENT = 0.25;
const MIN_BET_AMOUNT = 0.5;

app.use(express.json());

let isBotActive = true;
let lastTradeTimestamp = 0;
let currentBalance = 0.00;
let currentBetSize = 0.50;

let clobClient;
let account;
let signer;

// Инициализация
(async () => {
    try {
        if (!process.env.POLYMARKET_PRIVATE_KEY) throw new Error("Missing private key");
        account = privateKeyToAccount(process.env.POLYMARKET_PRIVATE_KEY);
        signer = createWalletClient({ account, transport: http('https://polygon-rpc.com') });
        console.log(`✅ Адрес на портфейла: ${account.address}`);

        clobClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chain: 137,
            signer,
        });
        console.log("✅ ClobClient инициализиран");

        // Генериране на L2 ключове (ако няма, създава)
        const creds = await clobClient.createOrDeriveApiKey();
        console.log("✅ L2 ключовете са готови");

        // Зареждане на съществуващи позиции (за TP/SL)
        await loadOurTrades(clobClient);

        // Автоматично обновяване на баланса (USDC) на всяка минута
        updateBalance();
        setInterval(updateBalance, 60 * 1000);

    } catch (err) {
        console.error("❌ Грешка при инициализация:", err.message);
    }
})();

async function getUSDCBalance(address) {
    // Временна заглушка – в реалност трябва ethers или viem да чете баланса
    // За да не усложняваме, за момента връщаме 0, докато не депозираш
    // След депозит ще оправим с истински RPC
    return 0;
}

async function updateBalance() {
    if (!account) return;
    const usdc = await getUSDCBalance(account.address);
    if (usdc !== null) currentBalance = usdc;
    console.log(`💰 USDC баланс = $${currentBalance.toFixed(2)}`);
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

async function executeTrade() {
    if (!isBotActive) return { success: false, error: "Bot disabled" };
    if (Date.now() - lastTradeTimestamp < COOLDOWN_TIME) return { success: false, error: "Cooldown" };
    if (!clobClient) return { success: false, error: "No CLOB client" };

    const marketData = await refreshLiquidMarkets();
    if (!marketData?.success) return { success: false, error: marketData?.error || "No market" };

    let betAmount = Math.min(currentBetSize, currentBalance * MAX_BET_PERCENT);
    if (betAmount < MIN_BET_AMOUNT) return { success: false, error: "Balance too low" };

    const hedgeCalc = calculateDoubleHedging(betAmount, marketData.prices.main, marketData.prices.hedgeUp, marketData.prices.hedgeDown);

    try {
        if (marketData.tokens[0]) {
            await clobClient.createOrder({
                tokenID: marketData.tokens[0],
                price: marketData.prices.main,
                side: "BUY",
                size: hedgeCalc.main.shares
            });
            console.log(`✅ Ордер 1/3: ${hedgeCalc.main.shares} shares at ${marketData.prices.main}`);
        }
        if (marketData.tokens[1]) {
            await clobClient.createOrder({
                tokenID: marketData.tokens[1],
                price: marketData.prices.hedgeUp,
                side: "BUY",
                size: hedgeCalc.hedgeUp.shares
            });
            console.log(`✅ Ордер 2/3: ${hedgeCalc.hedgeUp.shares} shares at ${marketData.prices.hedgeUp}`);
        }
        if (marketData.tokens[2]) {
            await clobClient.createOrder({
                tokenID: marketData.tokens[2],
                price: marketData.prices.hedgeDown,
                side: "BUY",
                size: hedgeCalc.hedgeDown.shares
            });
            console.log(`✅ Ордер 3/3: ${hedgeCalc.hedgeDown.shares} shares at ${marketData.prices.hedgeDown}`);
        }

        lastTradeTimestamp = Date.now();
        await sendToTelegram(`✅ Сделка ${betAmount} USDC\n${marketData.title}`);
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
    if (isBotActive && clobClient) {
        const marketData = await refreshLiquidMarkets();
        if (marketData?.success) {
            // Подаваме карта на цените за токените (tokenId -> цена)
            const priceMap = {};
            if (marketData.tokens[0]) priceMap[marketData.tokens[0]] = marketData.prices.main;
            if (marketData.tokens[1]) priceMap[marketData.tokens[1]] = marketData.prices.hedgeUp;
            if (marketData.tokens[2]) priceMap[marketData.tokens[2]] = marketData.prices.hedgeDown;
            await checkAndClosePositions(clobClient, priceMap, sendToTelegram);
        }
    }
}, 30 * 1000);

// API endpoints (същите като преди, без Firebase)
app.get('/get-settings', (req, res) => {
    res.json({
        balance: currentBalance.toFixed(2),
        betSize: currentBetSize.toFixed(2)
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
    res.send(`<!DOCTYPE html>...`); // запази стария HTML шаблон
});

app.listen(PORT, () => console.log(`🚀 HyperMeteo 24/7 работи на порт ${PORT}`));
