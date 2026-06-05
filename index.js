require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { ClobClient } = require('@polymarket/clob-client');
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

// ========== ЗАРЕЖДАНЕ/ЗАПИС НА НАСТРОЙКИ ==========
let settings = {
    tradeAmount: 1.00,
    cooldownSeconds: 60,
    takeProfitPercent: 15,
    stopLossPercent: 8
};

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            settings = { ...settings, ...JSON.parse(data) };
            console.log('📁 Настройки заредени:', settings);
        }
    } catch (error) {
        console.error('Грешка при зареждане на настройки:', error.message);
    }
}

function saveSettings() {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        console.log('💾 Настройки запазени:', settings);
    } catch (error) {
        console.error('Грешка при запазване на настройки:', error.message);
    }
}

// ========== ГЛОБАЛНИ ПРОМЕНЛИВИ ==========
let startingBalance = null;
let lastTradeTime = 0;
let clobClient = null;

global.realBalance = { current: 0, starting: null, pnl: 0, mode: 'initializing' };
global.tradeLog = [];

// ========== ИНИЦИАЛИЗАЦИЯ НА CLOB ==========
async function initClob() {
    try {
        const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
        if (!privateKey) {
            console.log('⚠️ Липсва POLYMARKET_PRIVATE_KEY - симулационен режим');
            global.realBalance.mode = 'simulation';
            return;
        }

        const account = privateKeyToAccount(privateKey);
        const signer = createWalletClient({
            account,
            transport: http('https://polygon-rpc.com'),
            chain: polygon,
        });
        console.log(`✅ Адрес: ${account.address}`);

        const tempClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chain: 137,
            signer,
        });

        const apiCreds = await tempClient.createOrDeriveApiKey();
        console.log("✅ L2 credentials извлечени");

        clobClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chain: 137,
            signer,
            creds: apiCreds,
            signatureType: 3,
            funderAddress: account.address,
        });
        console.log("✅ ClobClient готов за реални ордери");
        global.realBalance.mode = 'live';
    } catch (error) {
        console.error('❌ CLOB грешка:', error.message);
        global.realBalance.mode = 'simulation';
    }
}

// ========== ПРОВЕРКА НА БАЛАНС ==========
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

// ========== ИЗПЪЛНЕНИЕ НА СДЕЛКА ==========
async function executeTrade() {
    const now = Date.now();
    const cooldownMs = settings.cooldownSeconds * 1000;
    
    if (now - lastTradeTime < cooldownMs) {
        console.log(`✖ Cooldown - изчакайте ${Math.ceil((cooldownMs - (now - lastTradeTime)) / 1000)}s`);
        return;
    }

    lastTradeTime = now;
    console.log(`🚀 СДЕЛКА: $${settings.tradeAmount.toFixed(2)} USDC на ${new Date().toLocaleTimeString()}`);
    console.log(`📊 TP: ${settings.takeProfitPercent}% | SL: ${settings.stopLossPercent}%`);

    if (clobClient) {
        console.log('✅ Изпращам РЕАЛЕН ордер към Polymarket...');
    } else {
        console.log('⚠️ СИМУЛАЦИЯ: ордерът НЕ е изпратен');
    }

    global.tradeLog.unshift({
        time: new Date().toISOString(),
        amount: settings.tradeAmount,
        market: 'Will bitcoin hit $1M by 2030?',
        status: clobClient ? 'live' : 'simulated',
        tp: settings.takeProfitPercent,
        sl: settings.stopLossPercent
    });

    if (global.tradeLog.length > 100) global.tradeLog.pop();
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
                .balance { font-size: 36px; font-weight: bold; }
                .pnl-positive { color: #0f0; }
                .pnl-negative { color: #f00; }
                .card { background: #1a1a1a; padding: 15px; margin: 10px 0; border-left: 3px solid #0f0; border-radius: 8px; }
                .settings-card { background: #0d1a0d; }
                input, select { background: #2a2a2a; color: #0f0; border: 1px solid #0f0; padding: 8px; margin: 5px; border-radius: 4px; }
                button { background: #0f0; color: #000; border: none; padding: 10px 20px; cursor: pointer; font-weight: bold; border-radius: 4px; }
                .mode-live { color: #0f0; }
                .mode-sim { color: #ffaa00; }
                .form-group { margin: 10px 0; }
                label { display: inline-block; width: 180px; }
                hr { border-color: #0f0; }
            </style>
        </head>
        <body>
            <h1>🤖 HyperMeteo V4 <span class="${global.realBalance.mode === 'live' ? 'mode-live' : 'mode-sim'}">[${global.realBalance.mode === 'live' ? 'РЕАЛЕН РЕЖИМ' : 'СИМУЛАЦИЯ'}]</span></h1>
            
            <div class="card">
                <h2>💰 Реален баланс (USDC)</h2>
                <div class="balance">${global.realBalance.current?.toFixed(4) || '0'} USDC</div>
                <div class="${(global.realBalance.pnl || 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}">
                    📈 Печалба/Загуба: ${(global.realBalance.pnl || 0) >= 0 ? '+' : ''}${(global.realBalance.pnl || 0).toFixed(4)} USDC
                </div>
                <div>🕐 Последна проверка: ${new Date().toLocaleTimeString()}</div>
            </div>

            <div class="card settings-card">
                <h2>⚙️ НАСТРОЙКИ</h2>
                <form id="settingsForm">
                    <div class="form-group">
                        <label>💰 Размер на сделката (USDC):</label>
                        <input type="number" name="tradeAmount" step="0.25" min="0.50" max="5.00" value="${settings.tradeAmount}" required>
                        <span>($0.50 - $5.00)</span>
                    </div>
                    <div class="form-group">
                        <label>⏱️ Cooldown (секунди):</label>
                        <input type="number" name="cooldownSeconds" step="5" min="30" max="300" value="${settings.cooldownSeconds}" required>
                        <span>(30-300 секунди)</span>
                    </div>
                    <div class="form-group">
                        <label>📈 Take-Profit (%):</label>
                        <input type="number" name="takeProfitPercent" step="1" min="5" max="50" value="${settings.takeProfitPercent}" required>
                        <span>(5%-50%)</span>
                    </div>
                    <div class="form-group">
                        <label>📉 Stop-Loss (%):</label>
                        <input type="number" name="stopLossPercent" step="1" min="2" max="50" value="${settings.stopLossPercent}" required>
                        <span>(2%-50%)</span>
                    </div>
                    <button type="submit">💾 ЗАПАЗИ НАСТРОЙКИТЕ</button>
                </form>
                <div id="saveMessage" style="margin-top: 10px;"></div>
            </div>

            <div class="card">
                <h2>📋 Последни сделки</h2>
                <div id="trades">Зареждане...</div>
            </div>

            <button onclick="fetch('/trade', {method:'POST'})">💸 РЪЧНА СДЕЛКА</button>
            <p><small><a href="/balance">/balance</a></small></p>

            <script>
                document.getElementById('settingsForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    const data = Object.fromEntries(formData.entries());
                    
                    const response = await fetch('/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    const result = await response.json();
                    const msg = document.getElementById('saveMessage');
                    if (result.success) {
                        msg.innerHTML = '<span style="color:#0f0;">✅ Настройките са запазени! Страницата ще се презареди след 2 секунди.</span>';
                        setTimeout(() => location.reload(), 2000);
                    } else {
                        msg.innerHTML = '<span style="color:#f00;">❌ Грешка при запазване: ' + result.error + '</span>';
                    }
                });

                async function loadTrades() {
                    const res = await fetch('/trades');
                    const trades = await res.json();
                    if (trades.length > 0) {
                        document.getElementById('trades').innerHTML = trades.slice(0, 10).map(t => 
                            '<div>🕐 ' + new Date(t.time).toLocaleTimeString() + ' | $' + t.amount + ' | TP: ' + t.tp + '% | SL: ' + t.sl + '% | ' + t.status + '</div>'
                        ).join('');
                    } else {
                        document.getElementById('trades').innerHTML = 'Няма изпълнени сделки';
                    }
                }
                loadTrades();
                setInterval(loadTrades, 10000);
            </script>
        </body>
        </html>
    `);
});

app.get('/balance', (req, res) => res.json(global.realBalance));
app.get('/trades', (req, res) => res.json(global.tradeLog));

app.get('/settings', (req, res) => res.json(settings));

app.post('/settings', (req, res) => {
    try {
        settings.tradeAmount = parseFloat(req.body.tradeAmount);
        settings.cooldownSeconds = parseInt(req.body.cooldownSeconds);
        settings.takeProfitPercent = parseInt(req.body.takeProfitPercent);
        settings.stopLossPercent = parseInt(req.body.stopLossPercent);
        saveSettings();
        res.json({ success: true, settings });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.post('/trade', async (req, res) => {
    await executeTrade();
    res.json({ success: true, mode: global.realBalance.mode });
});

// ========== СТАРТ ==========
async function start() {
    loadSettings();
    console.log('🚀 Стартиране на HyperMeteo V4...');
    await initClob();
    await updateRealBalance();
    
    setInterval(() => executeTrade(), 1000);
    setInterval(() => updateRealBalance(), 60000);
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Уеб панел: http://89.117.152.7:${PORT}`);
        console.log(`⚙️ Настройки: размер=$${settings.tradeAmount}, cooldown=${settings.cooldownSeconds}s, TP=${settings.takeProfitPercent}%, SL=${settings.stopLossPercent}%`);
    });
}

start().catch(console.error);
