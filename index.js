require('dotenv').config();

const express = require('express');
const axios = require('axios');
const { ClobClient } = require('@polymarket/clob-client-v2');
const { createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { polygon } = require('viem/chains');
const { refreshLiquidMarkets } = require('./marketScanner');
const { loadOurTrades, checkAndClosePositions } = require('./positionTracker');

const app = express();
const PORT = process.env.PORT || 3000;

const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AUTO_TRADE_INTERVAL = 60 * 1000;
const COOLDOWN_TIME = 60 * 1000;
const MAX_BET_PERCENT = 0.25;
const MIN_BET_AMOUNT = 0.5;

app.use(express.json());

let isBotActive = true;
let lastTradeTimestamp = 0;
let currentBalance = 17.93;
let currentBetSize = 1.00;

let clobClient;
let account;
let signer;

(async () => {
    try {
        if (!process.env.POLYMARKET_PRIVATE_KEY) throw new Error("Missing POLYMARKET_PRIVATE_KEY");
        
        // 1. Създаваме account и signer от частния ключ
        account = privateKeyToAccount(process.env.POLYMARKET_PRIVATE_KEY);
        signer = createWalletClient({ account, transport: http('https://polygon-rpc.com'), chain: polygon });
        console.log(`✅ Адрес на портфейла (EOA): ${account.address}`);

        // 2. ВРЕМЕНЕН КЛИЕНТ – само за извличане на L2 credentials
        const tempClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chain: 137,
            signer,
        });
        
        // 3. Извличаме L2 credentials (apiKey, secret, passphrase)
        const apiCreds = await tempClient.createOrDeriveApiKey();
        console.log("✅ L2 credentials извлечени успешно");

        // 4. ОСНОВЕН КЛИЕНТ – с credentials и funderAddress
        clobClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chain: 137,
            signer,
            creds: apiCreds,
            signatureType: 3,
            funderAddress: account.address,
        });
        console.log("✅ ClobClient инициализиран с L2 credentials");

        await loadOurTrades(clobClient);
    } catch (err) {
        console.error("❌ Грешка при инициализация:", err.message);
    }
})();

// ... останалият код (sendToTelegram, calculateDoubleHedging, executeTrade, API endpoints) остава същият като в предишната версия
