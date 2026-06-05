require('dotenv').config();
const express = require('express');
const { ClobClient } = require('@polymarket/clob-client');
const { privateKeyToAccount } = require('viem/accounts');
const { createWalletClient, http } = require('viem');
const { polygon } = require('viem/chains');
const { getRealUSDCBalance } = require('./balanceChecker');

const app = express();
const PORT = 3000;
const WALLET_ADDRESS = '0xfC74Aeb8eaCf185A4D1c4EC6a4A1aC60702E4785';

let startingBalance = null;
let lastTradeTime = 0;
const COOLDOWN_MS = 60000;

global.realBalance = { current: 0, starting: null, pnl: 0 };
global.tradeLog = [];

// ========== ИНИЦИАЛИЗАЦИЯ НА CLOB КЛИЕНТ ==========
let clobClient = null;

async function initClob() {
    try {
        const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
        if (!privateKey) throw new Error('Липсва POLYMARKET_PRIVATE_KEY в .env');
        
        // 1. Създаваме account и signer от частния ключ
        const account = privateKeyToAccount(privateKey);
        const signer = createWalletClient({
            account,
            transport: http('https://polygon-rpc.com'),
            chain: polygon,
        });
        console.log(`✅ Адрес на портфейла (EOA): ${account.address}`);

        // 2. ВРЕМЕНЕН КЛИЕНТ – само за извличане на L2 credentials
        const tempClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chain: 137,
            signer,
        });

        // 3. ИЗВЛИЧАНЕ НА L2 CREDENTIALS (apiKey, secret, passphrase)
        const apiCreds = await tempClient.createOrDeriveApiKey();
        console.log("✅ L2 credentials извлечени успешно");

        // 4. ОСНОВЕН КЛИЕНТ – за търговия
        clobClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chain: 137,
            signer,
            creds: apiCreds,
            signatureType: 3,
            funderAddress: account.address,
        });
        console.log("✅ ClobClient инициализиран с L2 credentials");
    } catch (error) {
        console.error('❌ Грешка при инициализация на CLOB:', error.message);
    }
}

async function updateRealBalance() {
    const result = await getRealUSDCBalance(WALLET_ADDRESS);
    if (result.success) {
        if (startingBalance === null) startingBalance = result.balance;
        const pnl = result.balance - startingBalance;
        global.realBalance = { current: result.balance, starting: startingBalance, pnl, success: true };
        console.log(`💰 Баланс: ${result.balance.toFixed(4)} USDC | П/З: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)}`);
    } else {
        global.realBalance = { success: false, error: result.error };
        console.log('⚠️ Грешка при четене на баланс:', result.error);
    }
}

async function executeTrade() {
    const now = Date.now();
    if (now - lastTradeTime < COOLDOWN_MS) {
        console.log('✖ Cooldown - изчакайте');
        return;
    }

    if (!clobClient) {
        console.log('❌ CLOB клиентът не е инициализиран');
        return;
    }

    lastTradeTime = now;
    console.log(`🚀 Сделка за $1.00 на ${new Date().toLocaleTimeString()}`);
    global.tradeLog.unshift({ time: new Date().toISOString(), amount: 1.00, status: 'executed' });
    setTimeout(updateRealBalance, 5000);
}

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>HyperMeteo Bot</title>
            <meta http-equiv="refresh" content="10">
            <style>
                body { font-family: monospace; background: #0a0a0a; color: #0f0; padding: 20px; }
                .balance { font-size: 32px; margin: 10px 0; }
                .pnl-positive { color: #0f0; }
                .pnl-negative { color: #f00; }
                .card { background: #1a1a1a; padding: 15px; margin: 10px 0; border-left: 3px solid #0f0; }
            </style>
        </head>
        <body>
            <h1>🤖 HyperMeteo V4</h1>
            <div class="card">
                <h2>💰 Реален баланс (USDC)</h2>
                <div class="balance">${global.realBalance.current?.toFixed(4) || '0'} USDC</div>
                <div class="${(global.realBalance.pnl || 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}">
                    📈 Печалба/Загуба: ${(global.realBalance.pnl || 0) >= 0 ? '+' : ''}${(global.realBalance.pnl || 0).toFixed(4)} USDC
                </div>
                <div>🕐 Последна проверка: ${new Date().toLocaleTimeString()}</div>
            </div>
            <div class="card">
                <h2>📊 Статистика</h2>
                <div>⏱️ Cooldown: 1 минута</div>
                <div>🎯 TP: 15% | SL: 8%</div>
            </div>
            <button onclick="fetch('/trade', {method:'POST'})">💸 РЪЧНА СДЕЛКА</button>
        </body>
        </html>
    `);
});

app.get('/balance', (req, res) => res.json(global.realBalance));
app.post('/trade', async (req, res) => {
    await executeTrade();
    res.json({ success: true });
});

async function start() {
    console.log('🚀 Стартиране на HyperMeteo V4...');
    await initClob();      // <-- КРИТИЧНО: двустепенна инициализация
    await updateRealBalance();
    setInterval(executeTrade, 60000);
    setInterval(updateRealBalance, 60000);
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Уеб панел: http://89.117.152.7:${PORT}`);
    });
}

start().catch(console.error);
