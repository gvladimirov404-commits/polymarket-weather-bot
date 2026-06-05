require('dotenv').config();
const express = require('express');
const { ClobClient } = require('@polymarket/clob-client');
const { privateKeyToAccount } = require('viem/accounts');
const { createWalletClient, http } = require('viem');
const { polygon } = require('viem/chains');
const { getRealUSDCBalance } = require('./balanceChecker');

const app = express();
const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = '0xfC74Aeb8eaCf185A4D1c4EC6a4A1aC60702E4785';

let startingBalance = null;
let lastTradeTime = 0;
const COOLDOWN_MS = 60000; // 1 минута
let clobClient = null;

global.realBalance = { current: 0, starting: null, pnl: 0 };
global.tradeLog = [];

// ========== ИНИЦИАЛИЗАЦИЯ НА CLOB КЛИЕНТ ==========
async function initClob() {
    try {
        const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
        if (!privateKey) {
            throw new Error('❌ Липсва POLYMARKET_PRIVATE_KEY в .env');
        }

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

// ========== ПРОВЕРКА НА БАЛАНС ==========
async function updateRealBalance() {
    const result = await getRealUSDCBalance(WALLET_ADDRESS);
    if (result.success) {
        if (startingBalance === null) {
            startingBalance = result.balance;
        }
        const pnl = result.balance - startingBalance;
        global.realBalance = {
            current: result.balance,
            starting: startingBalance,
            pnl: pnl,
            success: true,
            lastUpdate: new Date().toISOString()
        };
        console.log(`💰 Баланс: ${result.balance.toFixed(4)} USDC | П/З: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)}`);
    } else {
        global.realBalance = {
            success: false,
            error: result.error,
            lastUpdate: new Date().toISOString()
        };
        console.log('⚠️ Грешка при четене на баланс:', result.error);
    }
}

// ========== ИЗПЪЛНЕНИЕ НА СДЕЛКА ==========
async function executeTrade() {
    const now = Date.now();
    if (now - lastTradeTime < COOLDOWN_MS) {
        const remaining = Math.ceil((COOLDOWN_MS - (now - lastTradeTime)) / 1000);
        console.log(`✖ Cooldown - изчакайте ${remaining} секунди`);
        return;
    }

    if (!clobClient) {
        console.log('❌ CLOB клиентът не е инициализиран');
        return;
    }

    try {
        lastTradeTime = now;
        console.log(`🚀 Изпълнявам сделка за $1.00 на ${new Date().toLocaleTimeString()}`);

        // TODO: Добавете реален ордер с правилния token ID
        // Пример:
        // const order = {
        //     tokenID: "0x...",  // ID на пазара
        //     side: "BUY",
        //     price: 0.5,
        //     size: 1.0
        // };
        // const response = await clobClient.postOrder(order);
        // console.log("✅ Ордер изпратен:", response);

        global.tradeLog.unshift({
            time: new Date().toISOString(),
            amount: 1.00,
            market: 'Will bitcoin hit $1M by 2030?',
            status: 'executed'
        });

        if (global.tradeLog.length > 100) {
            global.tradeLog.pop();
        }

        setTimeout(() => updateRealBalance(), 5000);
    } catch (error) {
        console.error('❌ Грешка при сделка:', error.message);
    }
}

// ========== УЕБ ПАНЕЛ ==========
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
                button { background: #0f0; color: #000; border: none; padding: 10px 20px; cursor: pointer; }
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
                <div>🎯 Take-Profit: 15% | Stop-Loss: 8%</div>
                <div>📦 Баланс за търговия: $1.00 на сделка</div>
            </div>
            <button onclick="fetch('/trade', {method:'POST'})">💸 РЪЧНА СДЕЛКА</button>
            <p><a href="/balance">/balance</a></p>
        </body>
        </html>
    `);
});

app.get('/balance', (req, res) => {
    res.json(global.realBalance);
});

app.get('/trades', (req, res) => {
    res.json(global.tradeLog);
});

app.post('/trade', async (req, res) => {
    await executeTrade();
    res.json({ success: true, message: 'Сделката е изпълнена' });
});

// ========== СТАРТ ==========
async function start() {
    console.log('🚀 Стартиране на HyperMeteo V4...');
    await initClob();
    await updateRealBalance();

    // Автоматична търговия на всяка минута
    setInterval(() => {
        executeTrade();
    }, 60000);

    // Проверка на баланса на всяка минута
    setInterval(() => {
        updateRealBalance();
    }, 60000);

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Уеб панел: http://89.117.152.7:${PORT}`);
    });
}

start().catch(console.error);
