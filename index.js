require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { ClobClient, Side, OrderType } = require('@polymarket/clob-client-v2');
const { privateKeyToAccount } = require('viem/accounts');
const { createWalletClient, http } = require('viem');
const { polygon } = require('viem/chains');
const { getRealUSDCBalance } = require('./balanceChecker');

const app = express();
const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = '0xfC74Aeb8eaCf185A4D1c4EC6a4A1aC60702E4785';
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const MARKET_NAME = 'Will bitcoin hit $1M by 2030?';
const TOKEN_OUTCOME = 'Yes'; // Купуваме "Да" токена

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
let accountAddress = null;
let marketTokenId = null;

global.realBalance = { current: 0, starting: null, pnl: 0, mode: 'initializing' };
global.tradeLog = [];

// ========== 1. ОТКРИВАНЕ НА TOKEN ID ==========
async function getMarketTokenId() {
    try {
        console.log(`🔍 Търсене на token ID за пазар: ${MARKET_NAME} (${TOKEN_OUTCOME})`);
        
        // Използваме Gamma API на Polymarket
        const response = await fetch('https://gamma-api.polymarket.com/markets');
        const markets = await response.json();
        
        const market = markets.find(m => m.question === MARKET_NAME);
        if (!market) {
            console.error(`❌ Пазарът не е намерен: ${MARKET_NAME}`);
            return null;
        }
        
        // Намираме токена за съответния изход (Yes/No)
        const token = market.tokens.find(t => t.outcome === TOKEN_OUTCOME);
        if (!token) {
            console.error(`❌ Токенът "${TOKEN_OUTCOME}" не е намерен`);
            return null;
        }
        
        console.log(`✅ Token ID: ${token.token_id}`);
        return token.token_id;
    } catch (error) {
        console.error('❌ Грешка при откриване на token ID:', error.message);
        return null;
    }
}

// ========== 2. ИНИЦИАЛИЗАЦИЯ НА CLOB V2 ==========
async function initClob() {
    try {
        const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
        if (!privateKey || privateKey.length < 10) {
            console.log('⚠️ Липсва POLYMARKET_PRIVATE_KEY - симулационен режим');
            global.realBalance.mode = 'simulation';
            return;
        }

        const account = privateKeyToAccount(privateKey);
        accountAddress = account.address;
        const signer = createWalletClient({
            account,
            transport: http('https://polygon-rpc.com'),
            chain: polygon,
        });
        console.log(`✅ Адрес: ${accountAddress}`);

        const tempClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chainId: 137,
            signer: signer
        });

        const apiCreds = await tempClient.createApiKey();
        console.log("✅ L2 credentials извлечени успешно (v2)");

        clobClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chainId: 137,
            signer: signer,
            creds: apiCreds,
            signatureType: 3,
            funderAddress: accountAddress
        });
        
        console.log("✅ ClobClient v2 инициализиран - ГОТОВ ЗА РЕАЛНИ ОРДЕРИ");
        
        // Откриваме token ID
        marketTokenId = await getMarketTokenId();
        if (marketTokenId) {
            console.log(`🎯 Пазарът е готов за търговия`);
            global.realBalance.mode = 'live';
        } else {
            console.log(`⚠️ Не може да се открие token ID - само симулация`);
            global.realBalance.mode = 'simulation';
        }
    } catch (error) {
        console.error('❌ CLOB грешка (v2):', error.message);
        global.realBalance.mode = 'simulation';
    }
}

// ========== 3. ПРОВЕРКА НА БАЛАНС ==========
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
    }
}

// ========== 4. ИЗПЪЛНЕНИЕ НА РЕАЛНА СДЕЛКА (MARKET ORDER) ==========
async function executeTrade() {
    const now = Date.now();
    const cooldownMs = settings.cooldownSeconds * 1000;
    
    if (now - lastTradeTime < cooldownMs) return;
    lastTradeTime = now;
    
    console.log(`🚀 СДЕЛКА: $${settings.tradeAmount.toFixed(2)} USDC | TP: ${settings.takeProfitPercent}% | SL: ${settings.stopLossPercent}%`);

    if (clobClient && marketTokenId) {
        try {
            console.log('📝 Изпращам MARKET ORDER към Polymarket...');
            
            // Използваме createAndPostMarketOrder за моментално изпълнение
            const response = await clobClient.createAndPostMarketOrder(
                {
                    tokenID: marketTokenId,
                    amount: settings.tradeAmount,
                    side: Side.BUY,
                    orderType: OrderType.FOK, // Fill-Or-Kill - цялата поръчка се изпълнява веднага или се отказва
                },
                { tickSize: "0.01" },
                OrderType.FOK
            );
            
            console.log(`✅ РЕАЛЕН ордер изпратен успешно!`);
            console.log(`📊 Отговор:`, JSON.stringify(response, null, 2).substring(0, 200));
            
            global.tradeLog.unshift({
                time: new Date().toISOString(),
                amount: settings.tradeAmount,
                market: MARKET_NAME,
                outcome: TOKEN_OUTCOME,
                status: 'live_order_sent',
                tp: settings.takeProfitPercent,
                sl: settings.stopLossPercent,
                response: response.success ? 'success' : 'failed'
            });
            
        } catch (error) {
            console.error('❌ Грешка при изпращане на ордер:', error.message);
            global.tradeLog.unshift({
                time: new Date().toISOString(),
                amount: settings.tradeAmount,
                market: MARKET_NAME,
                status: 'order_failed',
                error: error.message
            });
        }
    } else {
        console.log('⚠️ СИМУЛАЦИЯ: ордерът НЕ е изпратен (липсва token ID или CLOB)');
        global.tradeLog.unshift({
            time: new Date().toISOString(),
            amount: settings.tradeAmount,
            market: MARKET_NAME,
            status: 'simulated',
            tp: settings.takeProfitPercent,
            sl: settings.stopLossPercent
        });
    }
    
    if (global.tradeLog.length > 100) global.tradeLog.pop();
    setTimeout(() => updateRealBalance(), 5000);
}

// ========== УЕБ ПАНЕЛ ==========
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>HyperMeteo V4</title>
            <meta http-equiv="refresh" content="10">
            <style>
                body{background:#0a0a0a;color:#0f0;font-family:monospace;padding:20px}
                .live{color:#0f0}.sim{color:#ffaa00}
                .card{background:#1a1a1a;padding:15px;margin:10px 0;border-left:3px solid #0f0;border-radius:8px}
                input,button{background:#2a2a2a;color:#0f0;border:1px solid #0f0;padding:8px;margin:5px;border-radius:4px}
                button{background:#0f0;color:#000;cursor:pointer;font-weight:bold}
                .form-group{margin:10px 0}
                label{display:inline-block;width:200px}
            </style>
        </head>
        <body>
            <h1>🤖 HyperMeteo V4 <span class="${global.realBalance.mode === 'live' ? 'live' : 'sim'}">[${global.realBalance.mode === 'live' ? 'РЕАЛЕН РЕЖИМ' : 'СИМУЛАЦИЯ'}]</span></h1>
            <div class="card">
                <h2>💰 Баланс: ${global.realBalance.current?.toFixed(4) || '0'} USDC</h2>
                <h3>📈 П/З: ${(global.realBalance.pnl || 0) >= 0 ? '+' : ''}${(global.realBalance.pnl || 0).toFixed(4)} USDC</h3>
                <div>🤝 CLOB: ${clobClient ? '✅ ГОТОВ' : '⚠️ НЕАКТИВЕН'}</div>
                <div>🎯 Пазар: ${MARKET_NAME} (${TOKEN_OUTCOME})</div>
                ${marketTokenId ? `<div>🔑 Token ID: ${marketTokenId.substring(0, 20)}...</div>` : '<div>⚠️ Token ID не е открит</div>'}
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
            <p><small><a href="/balance">/balance</a> | <a href="/trades">/trades</a></small></p>
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
    app.listen(PORT, '0.0.0.0', () => console.log(`🌐 http://89.117.152.7:${PORT}`));
}

start().catch(console.error);
