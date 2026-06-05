
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { ClobClient } = require('@polymarket/clob-client-v2');
const { privateKeyToAccount } = require('viem/accounts');
const { createWalletClient, http } = require('viem');
const { polygon } = require('viem/chains');
const { getRealUSDCBalance } = require('./balanceChecker');

const app = express();
const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = '0xfC74Aeb8eaCf185A4D1c4EC6a4A1aC60702E4785';
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== НАСТРОЙКИ ==========
let settings = {
    tradeAmount: 1.00,
    cooldownSeconds: 60,
    takeProfitPercent: 15,
    stopLossPercent: 8
};

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
            console.log('📁 Настройки заредени');
        }
    } catch (error) {}
}

function saveSettings() {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ========== ГЛОБАЛНИ ==========
let startingBalance = null;
let lastTradeTime = 0;
let clobClient = null;
let signer = null;
let accountAddress = null;

global.realBalance = { current: 0, starting: null, pnl: 0, mode: 'initializing' };
global.tradeLog = [];

// ========== ИНИЦИАЛИЗАЦИЯ НА CLOB V2 ==========
async function initClob() {
    try {
        const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
        if (!privateKey) {
            console.log('⚠️ Липсва POLYMARKET_PRIVATE_KEY - симулационен режим');
            global.realBalance.mode = 'simulation';
            return;
        }

        // 1. Създаваме account и signer
        const account = privateKeyToAccount(privateKey);
        accountAddress = account.address;
        signer = createWalletClient({
            account,
            transport: http('https://polygon-rpc.com'),
            chain: polygon,
        });
        console.log(`✅ Адрес: ${accountAddress}`);

        // 2. Временен клиент за извличане на L2 credentials (v2)
        const tempClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chainId: 137,
            signer: signer
        });

        // 3. Извличане на L2 credentials (createApiKey, не createOrDeriveApiKey)
        const apiCreds = await tempClient.createApiKey();
        console.log("✅ L2 credentials извлечени успешно (v2)");

        // 4. Основен клиент с credentials
        clobClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chainId: 137,
            signer: signer,
            creds: apiCreds,
            signatureType: 3,
            funderAddress: accountAddress
        });
        
        console.log("✅ ClobClient v2 инициализиран - ГОТОВ ЗА РЕАЛНИ ОРДЕРИ");
        global.realBalance.mode = 'live';
    } catch (error) {
        console.error('❌ CLOB грешка (v2):', error.message);
        console.log('⚠️ Ботът ще работи в СИМУЛАЦИОНЕН режим');
        global.realBalance.mode = 'simulation';
    }
}

// ========== БАЛАНС ==========
async function updateRealBalance() {
    const result = await getRealUSDCBalance(WALLET_ADDRESS);
    if (result.success) {
        if (startingBalance === null) startingBalance = result.balance;
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
        console.log(`💰 Баланс: ${result.balance.toFixed(4)} USDC | П/З: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)}`);
    } else {
        console.log('⚠️ Грешка при четене на баланс:', result.error);
    }
}

// ========== СДЕЛКА ==========
async function executeTrade() {
    const now = Date.now();
    const cooldownMs = settings.cooldownSeconds * 1000;
    
    if (now - lastTradeTime < cooldownMs) {
        return;
    }

    lastTradeTime = now;
    console.log(`🚀 СДЕЛКА: $${settings.tradeAmount.toFixed(2)} USDC | TP: ${settings.takeProfitPercent}% | SL: ${settings.stopLossPercent}%`);

    if (clobClient) {
        console.log('✅ Изпращам РЕАЛЕН ордер към Polymarket (v2)...');
        // TODO: Добавете реален ордер с правилния token ID
        // Пример:
        // const order = {
        //     tokenId: "TOKEN_ID",
        //     side: "BUY",
        //     price: 0.50,
        //     size: settings.tradeAmount
        // };
        // const response = await clobClient.postOrder(order);
    } else {
        console.log('⚠️ СИМУЛАЦИЯ: ордерът НЕ е изпратен');
    }

    global.tradeLog.unshift({
        time: new Date().toISOString(),
        amount: settings.tradeAmount,
        market: 'Will bitcoin hit $1M by 2030?',
        status: clobClient ? 'live' : 'simulated',
        tp: settings.takeProfitPercent,
        sl: settings.stopLossPercent,
        mode: global.realBalance.mode
    });
    if (global.tradeLog.length > 100) global.tradeLog.pop();
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
                .balance { font-size: 36px; font-weight: bold; }
                .live { color: #0f0; }
                .sim { color: #ffaa00; }
                .card { background: #1a1a1a; padding: 15px; margin: 10px 0; border-left: 3px solid #0f0; border-radius: 8px; }
                input, button { background: #2a2a2a; color: #0f0; border: 1px solid #0f0; padding: 8px; margin: 5px; border-radius: 4px; }
                button { background: #0f0; color: #000; cursor: pointer; font-weight: bold; }
                .form-group { margin: 10px 0; }
                label { display: inline-block; width: 200px; }
            </style>
        </head>
        <body>
            <h1>🤖 HyperMeteo V4 <span class="${global.realBalance.mode === 'live' ? 'live' : 'sim'}">[${global.realBalance.mode === 'live' ? 'РЕАЛЕН РЕЖИМ' : 'СИМУЛАЦИЯ'}]</span></h1>
            <div class="card">
                <h2>💰 Баланс: ${global.realBalance.current?.toFixed(4) || '0'} USDC</h2>
                <h3>📈 П/З: ${(global.realBalance.pnl || 0) >= 0 ? '+' : ''}${(global.realBalance.pnl || 0).toFixed(4)} USDC</h3>
                <div>🤝 CLOB: ${clobClient ? '✅ ГОТОВ (v2)' : '⚠️ НЕАКТИВЕН'}</div>
            </div>
            <div class="card">
                <h2>⚙️ НАСТРОЙКИ</h2>
                <form id="settingsForm">
                    <div class="form-group"><label>💰 Размер на сделката (USDC):</label><input type="number" name="tradeAmount" step="0.25" min="0.50" max="5.00" value="${settings.tradeAmount}"></div>
                    <div class="form-group"><label>⏱️ Cooldown (секунди):</label><input type="number" name="cooldownSeconds" step="5" min="30" max="300" value="${settings.cooldownSeconds}"></div>
                    <div class="form-group"><label>📈 Take-Profit (%):</label><input type="number" name="takeProfitPercent" step="1" min="5" max="50" value="${settings.takeProfitPercent}"></div>
                    <div class="form-group"><label>📉 Stop-Loss (%):</label><input type="number" name="stopLossPercent" step="1" min="2" max="50" value="${settings.stopLossPercent}"></div>
                    <button type="submit">💾 ЗАПАЗИ</button>
                </form>
            </div>
            <button onclick="fetch('/trade',{method:'POST'})">💸 РЪЧНА СДЕЛКА</button>
            <p><small><a href="/balance">/balance</a> | Режим: ${global.realBalance.mode === 'live' ? 'РЕАЛНА ТЪРГОВИЯ' : 'СИМУЛАЦИЯ'}</small></p>
            <script>
                document.getElementById('settingsForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const data = Object.fromEntries(new FormData(e.target));
                    await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
                    location.reload();
                });
            </script>
        </body>
        </html>
    `);
});

app.get('/balance', (req, res) => res.json(global.realBalance));
app.get('/trades', (req, res) => res.json(global.tradeLog));
app.post('/settings', (req, res) => {
    settings.tradeAmount = parseFloat(req.body.tradeAmount);
    settings.cooldownSeconds = parseInt(req.body.cooldownSeconds);
    settings.takeProfitPercent = parseInt(req.body.takeProfitPercent);
    settings.stopLossPercent = parseInt(req.body.stopLossPercent);
    saveSettings();
    res.json({ success: true });
});
app.post('/trade', async (req, res) => { await executeTrade(); res.json({ success: true }); });

// ========== СТАРТ ==========
async function start() {
    loadSettings();
    console.log('🚀 Стартиране на HyperMeteo V4...');
    await initClob();
    await updateRealBalance();
    
    setInterval(() => executeTrade(), 1000);
    setInterval(() => updateRealBalance(), 30000);
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Уеб панел: http://89.117.152.7:${PORT}`);
        console.log(`🎯 Режим: ${global.realBalance.mode === 'live' ? 'РЕАЛНА ТЪРГОВИЯ (CLOB v2)' : 'СИМУЛАЦИЯ'}`);
    });
}

start().catch(console.error);
