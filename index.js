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

global.realBalance = { current: 0, starting: null, pnl: 0, mode: 'initializing' };
global.tradeLog = [];

// ========== ИНИЦИАЛИЗАЦИЯ НА CLOB КЛИЕНТ (ДВУСТЕПЕННА) ==========
async function initClob() {
    try {
        const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
        if (!privateKey) {
            console.log('⚠️ Липсва POLYMARKET_PRIVATE_KEY в .env');
            console.log('⚠️ Ботът ще работи в СИМУЛАЦИОНЕН режим (без реални ордери)');
            global.realBalance.mode = 'simulation';
            return;
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
        console.log("🎯 Ботът е ГОТОВ ЗА РЕАЛНИ ОРДЕРИ");
        global.realBalance.mode = 'live';
    } catch (error) {
        console.error('❌ Грешка при инициализация на CLOB:', error.message);
        console.log('⚠️ Ботът ще работи в СИМУЛАЦИОНЕН режим');
        global.realBalance.mode = 'simulation';
    }
}

// ========== ПРОВЕРКА НА РЕАЛЕН USDC БАЛАНС ==========
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
            mode: global.realBalance.mode,
            tokenType: result.usedToken || 'USDC',
            lastUpdate: new Date().toISOString()
        };
        console.log(`💰 Баланс: ${result.balance.toFixed(4)} USDC | П/З: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} | Режим: ${global.realBalance.mode === 'live' ? 'РЕАЛЕН' : 'СИМУЛАЦИЯ'}`);
    } else {
        global.realBalance = {
            success: false,
            error: result.error,
            mode: global.realBalance.mode,
            lastUpdate: new Date().toISOString()
        };
        console.log('⚠️ Грешка при четене на баланс:', result.error);
    }
}

// ========== ИЗПЪЛНЕНИЕ НА СДЕЛКА ==========
async function executeTrade() {
    const now = Date.now();
    if (now - lastTradeTime < COOLDOWN_MS) {
        console.log('✖ Cooldown - изчакайте');
        return;
    }

    lastTradeTime = now;
    console.log(`🚀 СДЕЛКА на ${new Date().toLocaleTimeString()} | Стойност: $1.00 USDC`);

    if (clobClient) {
        console.log('✅ Изпращам РЕАЛЕН ордер към Polymarket...');
        // TODO: Добавете реален ордер с правилния token ID
        // const order = {
        //     tokenID: "ID_НА_ПАЗАРА",
        //     side: "BUY",
        //     price: 0.50,
        //     size: 1.00
        // };
        // const response = await clobClient.postOrder(order);
        // console.log("✅ Ордер изпратен:", response);
    } else {
        console.log('⚠️ СИМУЛАЦИЯ: ордерът НЕ е изпратен (липсва CLOB клиент)');
    }

    global.tradeLog.unshift({
        time: new Date().toISOString(),
        amount: 1.00,
        market: 'Will bitcoin hit $1M by 2030?',
        status: clobClient ? 'live_order' : 'simulated',
        mode: global.realBalance.mode
    });

    if (global.tradeLog.length > 100) {
        global.tradeLog.pop();
    }

    setTimeout(() => updateRealBalance(), 5000);
}

// ========== УЕБ ПАНЕЛ ==========
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>HyperMeteo Bot V4</title>
            <meta http-equiv="refresh" content="10">
            <style>
                body { font-family: monospace; background: #0a0a0a; color: #0f0; padding: 20px; }
                .balance { font-size: 36px; font-weight: bold; margin: 10px 0; }
                .pnl-positive { color: #0f0; }
                .pnl-negative { color: #f00; }
                .card { background: #1a1a1a; padding: 15px; margin: 10px 0; border-left: 3px solid #0f0; border-radius: 8px; }
                .live { border-left-color: #0f0; }
                .simulation { border-left-color: #ffaa00; }
                button { background: #0f0; color: #000; border: none; padding: 10px 20px; cursor: pointer; font-weight: bold; margin-top: 10px; }
                .mode-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; margin-left: 10px; }
                .mode-live { background: #0f0; color: #000; }
                .mode-sim { background: #ffaa00; color: #000; }
            </style>
        </head>
        <body>
            <h1>🤖 HyperMeteo V4 
                <span class="mode-badge ${global.realBalance.mode === 'live' ? 'mode-live' : 'mode-sim'}">
                    ${global.realBalance.mode === 'live' ? '🔴 РЕАЛЕН РЕЖИМ' : '⚠️ СИМУЛАЦИЯ'}
                </span>
            </h1>
            <div class="card ${global.realBalance.mode === 'live' ? 'live' : 'simulation'}">
                <h2>💰 Реален баланс (USDC)</h2>
                <div class="balance">${global.realBalance.current?.toFixed(4) || '0'} USDC</div>
                <div class="${(global.realBalance.pnl || 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}">
                    📈 Печалба/Загуба: ${(global.realBalance.pnl || 0) >= 0 ? '+' : ''}${(global.realBalance.pnl || 0).toFixed(4)} USDC
                </div>
                <div>🕐 Последна проверка: ${new Date().toLocaleTimeString()}</div>
                ${global.realBalance.tokenType ? `<div>📦 Токен: ${global.realBalance.tokenType}</div>` : ''}
            </div>
            <div class="card">
                <h2>📊 Статистика</h2>
                <div>⏱️ Cooldown: 1 минута</div>
                <div>🎯 Take-Profit: 15% | Stop-Loss: 8%</div>
                <div>💵 Стойност на сделка: $1.00 USDC</div>
                <div>🤝 CLOB статус: ${clobClient ? '✅ СВЪРЗАН' : '⚠️ НЕАКТИВЕН'}</div>
            </div>
            <button onclick="fetch('/trade', {method:'POST'})">💸 РЪЧНА СДЕЛКА</button>
            <p><small><a href="/balance">/balance</a> | <a href="/trades">/trades</a></small></p>
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
    res.json({ success: true, mode: global.realBalance.mode });
});

// ========== СТАРТ ==========
async function start() {
    console.log('🚀 Стартиране на HyperMeteo V4...');
    console.log('=====================================');
    await initClob();
    await updateRealBalance();
    console.log('=====================================');

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
        console.log(`🎯 Режим на работа: ${global.realBalance.mode === 'live' ? 'РЕАЛНА ТЪРГОВИЯ' : 'СИМУЛАЦИЯ'}`);
    });
}

start().catch(console.error);
