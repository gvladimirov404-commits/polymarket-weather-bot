cd /root/polymarket-weather-bot
cat > index.js << 'EOF'
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let settings = {
    marketName: '',
    marketTokenId: '',
    tokenOutcome: 'Yes',
    tradeAmount: 0.35,
    cooldownSeconds: 60,
    takeProfitPercent: 8,
    stopLossPercent: 4
};

let tradesHistory = [];
let startingBalance = null;
let lastTradeTime = 0;
let clobClient = null;
let currentBalance = 0;

global.realBalance = { current: 0, starting: null, pnl: 0 };

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

// ========== ИНИЦИАЛИЗАЦИЯ НА CLOB (според Polymarket) ==========
async function initClob() {
    try {
        let privateKey = process.env.POLYMARKET_PRIVATE_KEY;
        if (!privateKey) {
            console.log('⚠️ Липсва POLYMARKET_PRIVATE_KEY - симулационен режим');
            return false;
        }
        
        // КЛЮЧОВО: Гарантираме, че ключът започва с 0x
        if (!privateKey.startsWith('0x')) {
            privateKey = '0x' + privateKey;
        }
        
        // КЛЮЧОВО: Привеждаме към тип `0x${string}` както изисква Polymarket
        const account = privateKeyToAccount(privateKey);
        const signer = createWalletClient({ 
            account, 
            transport: http('https://polygon-rpc.com'),
            chain: polygon
        });
        
        console.log(`✅ Адрес: ${account.address}`);
        
        const tempClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chainId: 137,
            signer
        });
        
        // Използваме createOrDeriveApiKey() както е в примера
        const apiCreds = await tempClient.createOrDeriveApiKey();
        console.log("✅ L2 credentials извлечени успешно (v2)");
        
        clobClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chainId: 137,
            signer,
            creds: apiCreds,
            signatureType: 3,
            funderAddress: account.address
        });
        
        console.log("✅ ClobClient v2 инициализиран - ГОТОВ ЗА РЕАЛНИ ОРДЕРИ");
        return true;
    } catch (error) {
        console.error('❌ CLOB грешка:', error.message);
        return false;
    }
}

async function updateRealBalance() {
    const result = await getRealUSDCBalance(WALLET_ADDRESS);
    if (result.success) {
        currentBalance = result.balance;
        if (startingBalance === null) startingBalance = result.balance;
        const pnl = result.balance - startingBalance;
        global.realBalance = { current: result.balance, starting: startingBalance, pnl, success: true };
        console.log(`💰 Баланс: ${result.balance.toFixed(4)} USDC | П/З: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)}`);
    }
}

async function executeTrade() {
    const now = Date.now();
    if (now - lastTradeTime < settings.cooldownSeconds * 1000) return;
    if (!settings.marketTokenId) { console.log('⚠️ Няма избран пазар'); return; }
    
    lastTradeTime = now;
    console.log(`🚀 СДЕЛКА: $${settings.tradeAmount.toFixed(2)} USDC | ${settings.marketName}`);
    
    if (clobClient) {
        try {
            const response = await clobClient.createAndPostMarketOrder(
                { tokenID: settings.marketTokenId, amount: settings.tradeAmount, side: Side.BUY, orderType: OrderType.FOK },
                { tickSize: "0.01" },
                OrderType.FOK
            );
            console.log(`✅ РЕАЛЕН ордер изпратен!`);
        } catch (error) {
            console.error('❌ Грешка при ордер:', error.message);
        }
    } else {
        console.log('⚠️ СИМУЛАЦИЯ: няма CLOB клиент');
    }
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
                body{background:#0a0a0c;color:#0f0;font-family:monospace;padding:20px}
                .card{background:#141418;padding:20px;border-radius:16px;margin-bottom:20px}
                input,button{background:#1e1e24;border:1px solid #2a2a30;color:#0f0;padding:8px;border-radius:8px}
                button{background:#0f0;color:#000;cursor:pointer}
            </style>
        </head>
        <body>
            <div class="card">
                <h1>🤖 HyperMeteo V4</h1>
                <div>💰 Баланс: ${currentBalance.toFixed(4)} USDC</div>
                <div>📈 П/З: ${(currentBalance - (startingBalance || currentBalance)).toFixed(4)} USDC</div>
                <div>🤝 CLOB: ${clobClient ? '✅ РЕАЛЕН РЕЖИМ' : '⚠️ СИМУЛАЦИЯ'}</div>
            </div>
            <div class="card">
                <h2>⚙️ НАСТРОЙКИ</h2>
                <form id="settingsForm">
                    <div>💰 Размер: <input name="tradeAmount" value="${settings.tradeAmount}"></div>
                    <div>⏱️ Cooldown (сек): <input name="cooldownSeconds" value="${settings.cooldownSeconds}"></div>
                    <div>📈 TP %: <input name="takeProfitPercent" value="${settings.takeProfitPercent}"></div>
                    <div>📉 SL %: <input name="stopLossPercent" value="${settings.stopLossPercent}"></div>
                    <button type="submit">💾 ЗАПАЗИ</button>
                </form>
            </div>
            <button onclick="fetch('/trade',{method:'POST'})">💸 РЪЧНА СДЕЛКА</button>
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
app.post('/settings', (req, res) => {
    settings.tradeAmount = parseFloat(req.body.tradeAmount);
    settings.cooldownSeconds = parseInt(req.body.cooldownSeconds);
    settings.takeProfitPercent = parseInt(req.body.takeProfitPercent);
    settings.stopLossPercent = parseInt(req.body.stopLossPercent);
    saveSettings();
    res.json({ success: true });
});
app.post('/trade', async (req, res) => { await executeTrade(); res.json({ success: true }); });

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
EOF
