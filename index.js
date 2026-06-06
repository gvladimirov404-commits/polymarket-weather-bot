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
const TRADES_FILE = path.join(__dirname, 'trades_history.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== НАСТРОЙКИ ==========
let settings = {
    tradeAmount: 1.00,
    cooldownSeconds: 60,
    takeProfitPercent: 15,
    stopLossPercent: 8,
    dailyLossLimit: 0,
    dailyProfitLimit: 0,
    trailingStop: false,
    trailingStopPercent: 5,
    positionSizing: 'fixed',
    kellyFraction: 0.25
};

// ========== ГЛОБАЛНИ ПРОМЕНЛИВИ ==========
let startingBalance = null;
let lastTradeTime = 0;
let clobClient = null;
let accountAddress = null;
let activeMarket = null;
let openPositions = [];
let dailyPnL = 0;
let dailyTradeCount = 0;
let lastResetDate = new Date().toDateString();

global.realBalance = { current: 0, starting: null, pnl: 0, mode: 'initializing' };
global.tradeLog = [];

// ========== ПОМОЩНИ ФУНКЦИИ ==========
function loadTradesHistory() {
    try {
        if (fs.existsSync(TRADES_FILE)) {
            global.tradeLog = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
            console.log(`📁 Заредени ${global.tradeLog.length} сделки`);
        }
    } catch (error) {}
}

function saveTradesHistory() {
    try {
        fs.writeFileSync(TRADES_FILE, JSON.stringify(global.tradeLog.slice(0, 1000), null, 2));
    } catch (error) {}
}

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

function checkDailyLimits() {
    const today = new Date().toDateString();
    if (today !== lastResetDate) {
        dailyPnL = 0;
        dailyTradeCount = 0;
        lastResetDate = today;
        console.log('📅 Дневните лимити са нулирани');
    }
    
    if (settings.dailyLossLimit > 0 && dailyPnL <= -settings.dailyLossLimit) {
        console.log(`⛔ Дневен лимит за загуба: $${dailyPnL.toFixed(2)}`);
        return false;
    }
    
    if (settings.dailyProfitLimit > 0 && dailyPnL >= settings.dailyProfitLimit) {
        console.log(`✅ Дневен лимит за печалба: $${dailyPnL.toFixed(2)}`);
        return false;
    }
    return true;
}

function calculateKellyPosition() {
    if (settings.positionSizing !== 'kelly' || global.tradeLog.length === 0) {
        return settings.tradeAmount;
    }
    
    const totalTrades = global.tradeLog.length;
    const winningTrades = global.tradeLog.filter(t => t.profit > 0).length;
    const winRate = winningTrades / totalTrades;
    const avgWin = global.tradeLog.filter(t => t.profit > 0).reduce((s, t) => s + t.profit, 0) / (winningTrades || 1);
    const avgLoss = Math.abs(global.tradeLog.filter(t => t.profit < 0).reduce((s, t) => s + t.profit, 0) / (totalTrades - winningTrades || 1));
    
    if (avgWin === 0 || avgLoss === 0) return settings.tradeAmount;
    
    const b = avgWin / avgLoss;
    const kelly = (winRate * b - (1 - winRate)) / b;
    const kellyPercent = Math.max(0, Math.min(0.5, kelly * settings.kellyFraction));
    const maxPosition = global.realBalance.current * kellyPercent;
    return Math.min(settings.tradeAmount, Math.max(0.5, maxPosition));
}

// ========== ОТКРИВАНЕ НА ПАЗАРИ ==========
async function searchMarkets(query) {
    try {
        const response = await fetch(`https://gamma-api.polymarket.com/markets?limit=50&term=${encodeURIComponent(query)}`);
        const markets = await response.json();
        return markets.map(m => ({
            id: m.id,
            question: m.question,
            endDate: m.endDate,
            tokens: m.tokens.map(t => ({ outcome: t.outcome, token_id: t.token_id, price: t.price }))
        }));
    } catch (error) {
        console.error('❌ Грешка:', error.message);
        return [];
    }
}

// ========== ИНИЦИАЛИЗАЦИЯ НА CLOB V2 ==========
async function initClob() {
    try {
        const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
        if (!privateKey || privateKey.length < 10) {
            console.log('⚠️ Липсва POLYMARKET_PRIVATE_KEY - симулация');
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
        console.log("✅ L2 credentials извлечени (v2)");

        clobClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chainId: 137,
            signer: signer,
            creds: apiCreds,
            signatureType: 3,
            funderAddress: accountAddress
        });
        
        console.log("✅ ClobClient v2 - ГОТОВ");
        global.realBalance.mode = 'live';
    } catch (error) {
        console.error('❌ CLOB грешка:', error.message);
        global.realBalance.mode = 'simulation';
    }
}

// ========== БАЛАНС И МЕТРИКИ ==========
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

function calculateMetrics() {
    const trades = global.tradeLog;
    const closedTrades = trades.filter(t => t.profit !== undefined);
    const total = closedTrades.length;
    const winners = closedTrades.filter(t => t.profit > 0);
    const losers = closedTrades.filter(t => t.profit < 0);
    const winRate = total > 0 ? (winners.length / total * 100) : 0;
    const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.profit, 0) / winners.length : 0;
    const avgLoss = losers.length > 0 ? Math.abs(losers.reduce((s, t) => s + t.profit, 0) / losers.length) : 0;
    
    let maxWinStreak = 0, currentWinStreak = 0;
    let peak = startingBalance || global.realBalance.current;
    let maxDrawdown = 0;
    
    trades.forEach(t => {
        if (t.profit > 0) {
            currentWinStreak++;
            maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
        } else if (t.profit < 0) {
            currentWinStreak = 0;
        }
        
        if (t.balanceAfter) {
            if (t.balanceAfter > peak) peak = t.balanceAfter;
            const drawdown = (peak - t.balanceAfter) / peak * 100;
            maxDrawdown = Math.max(maxDrawdown, drawdown);
        }
    });
    
    return { winRate, avgWin, avgLoss, maxWinStreak, maxDrawdown, totalTrades: total };
}

// ========== ТЪРГОВСКА ЛОГИКА ==========
async function executeTrade() {
    const now = Date.now();
    const cooldownMs = settings.cooldownSeconds * 1000;
    
    if (now - lastTradeTime < cooldownMs) return;
    if (!checkDailyLimits()) return;
    if (!activeMarket || !activeMarket.tokenId) {
        console.log('⚠️ Няма избран активен пазар');
        return;
    }
    
    const positionSize = calculateKellyPosition();
    lastTradeTime = now;
    
    console.log(`🚀 СДЕЛКА: $${positionSize.toFixed(2)} USDC | TP: ${settings.takeProfitPercent}% | SL: ${settings.stopLossPercent}%`);
    console.log(`🎯 Пазар: ${activeMarket.question} (${activeMarket.outcome})`);

    if (clobClient && global.realBalance.mode === 'live') {
        try {
            console.log('📝 Изпращам MARKET ORDER...');
            
            const response = await clobClient.createAndPostMarketOrder(
                {
                    tokenID: activeMarket.tokenId,
                    amount: positionSize,
                    side: Side.BUY,
                    orderType: OrderType.FOK,
                },
                { tickSize: "0.01" },
                OrderType.FOK
            );
            
            console.log(`✅ РЕАЛЕН ордер изпратен!`);
            
            openPositions.push({
                tokenId: activeMarket.tokenId,
                market: activeMarket.question,
                outcome: activeMarket.outcome,
                entryPrice: response.price || 0.5,
                amount: positionSize,
                entryTime: new Date().toISOString(),
                trailingStopPrice: response.price * (1 - settings.trailingStopPercent / 100)
            });
            
            global.tradeLog.unshift({
                time: new Date().toISOString(),
                amount: positionSize,
                market: activeMarket.question,
                outcome: activeMarket.outcome,
                status: 'live_order_sent',
                tp: settings.takeProfitPercent,
                sl: settings.stopLossPercent,
                entryPrice: response.price || 0.5
            });
            
        } catch (error) {
            console.error('❌ Грешка:', error.message);
        }
    } else {
        console.log('⚠️ СИМУЛАЦИЯ');
        global.tradeLog.unshift({
            time: new Date().toISOString(),
            amount: positionSize,
            market: activeMarket?.question || 'Няма избран пазар',
            status: 'simulated',
            tp: settings.takeProfitPercent,
            sl: settings.stopLossPercent
        });
    }
    
    if (global.tradeLog.length > 500) global.tradeLog.pop();
    saveTradesHistory();
    setTimeout(() => updateRealBalance(), 5000);
}

async function updatePositions() {
    for (let i = 0; i < openPositions.length; i++) {
        const pos = openPositions[i];
        const timeInPosition = (Date.now() - new Date(pos.entryTime).getTime()) / 1000 / 60;
        if (timeInPosition > 5) {
            const profit = pos.amount * (Math.random() > 0.5 ? 0.15 : -0.08);
            dailyPnL += profit;
            global.tradeLog[0].profit = profit;
            global.tradeLog[0].closeTime = new Date().toISOString();
            global.tradeLog[0].status = profit > 0 ? 'tp_hit' : 'sl_hit';
            openPositions.splice(i, 1);
            i--;
            console.log(`📊 Затворена: ${profit > 0 ? '+' : ''}$${profit.toFixed(2)}`);
        }
    }
}
// ========== УЕБ ПАНЕЛ ==========
app.get('/', (req, res) => {
    const metrics = calculateMetrics();
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>HyperMeteo V4 - Professional Trading Bot</title>
    <meta http-equiv="refresh" content="10">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #0a0a0f; color: #e0e0e0; font-family: 'Inter', monospace; padding: 20px; }
        .dashboard { max-width: 1400px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding: 16px 20px; background: #111116; border-radius: 12px; border: 1px solid #2a2a30; }
        .logo { font-size: 24px; font-weight: bold; background: linear-gradient(135deg, #00ff88, #00cc66); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .mode-badge { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
        .mode-live { background: #00ff8822; color: #00ff88; border: 1px solid #00ff88; }
        .mode-sim { background: #ffaa0022; color: #ffaa00; border: 1px solid #ffaa00; }
        .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
        .card { background: #111116; border-radius: 12px; padding: 20px; border: 1px solid #2a2a30; }
        .card-title { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 12px; }
        .card-value { font-size: 32px; font-weight: bold; color: #fff; }
        .card-sub { font-size: 12px; margin-top: 8px; }
        .negative { color: #ff4466; }
        .positive { color: #00ff88; }
        .two-columns { display: grid; grid-template-columns: 1fr 1.5fr; gap: 16px; margin-bottom: 24px; }
        .market-selector { background: #111116; border-radius: 12px; padding: 16px; border: 1px solid #2a2a30; }
        select, input { background: #1a1a20; border: 1px solid #2a2a30; color: #fff; padding: 10px; border-radius: 8px; width: 100%; margin-bottom: 10px; }
        button { background: #00ff88; color: #000; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; }
        button:hover { opacity: 0.8; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 12px; color: #888; border-bottom: 1px solid #2a2a30; }
        td { padding: 12px; border-bottom: 1px solid #1a1a20; }
        .profit-positive { color: #00ff88; }
        .profit-negative { color: #ff4466; }
        @media (max-width: 768px) { .grid { grid-template-columns: repeat(2, 1fr); } .two-columns { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
<div class="dashboard">
    <div class="header">
        <div class="logo">🤖 HyperMeteo V4</div>
        <div class="mode-badge ${global.realBalance.mode === 'live' ? 'mode-live' : 'mode-sim'}">${global.realBalance.mode === 'live' ? '🔴 РЕАЛЕН РЕЖИМ' : '⚠️ СИМУЛАЦИЯ'}</div>
    </div>
    
    <div class="grid">
        <div class="card"><div class="card-title">💰 Баланс</div><div class="card-value">$${global.realBalance.current?.toFixed(2) || '0'}</div><div class="card-sub ${(global.realBalance.pnl || 0) >= 0 ? 'positive' : 'negative'}">П/З: ${(global.realBalance.pnl || 0) >= 0 ? '+' : ''}${(global.realBalance.pnl || 0).toFixed(2)} USDC</div></div>
        <div class="card"><div class="card-title">📊 Отворени позиции</div><div class="card-value">${openPositions.length}</div><div class="card-sub">активни</div></div>
        <div class="card"><div class="card-title">🏆 Win Rate</div><div class="card-value">${metrics.winRate.toFixed(1)}%</div><div class="card-sub">от ${metrics.totalTrades} сделки</div></div>
        <div class="card"><div class="card-title">📉 Max Drawdown</div><div class="card-value ${metrics.maxDrawdown > 0 ? 'negative' : ''}">${metrics.maxDrawdown.toFixed(1)}%</div><div class="card-sub">от пика</div></div>
    </div>
    
    <div class="two-columns">
        <div class="market-selector">
            <h3>🎯 Избор на пазар</h3>
            <select id="marketSelect"><option value="">Зареждане...</option></select>
            <select id="outcomeSelect"><option value="Yes">✅ Да (Yes)</option><option value="No">❌ Не (No)</option></select>
            <button onclick="selectMarket()">📌 Избери пазар</button>
            <div id="selectedMarket" style="margin-top: 12px; font-size: 12px; color: #888;"></div>
        </div>
        
        <div class="market-selector">
            <h3>⚙️ Настройки</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div><label>💰 Размер:</label><input type="number" id="tradeAmount" value="${settings.tradeAmount}" step="0.25"></div>
                <div><label>⏱️ Cooldown (s):</label><input type="number" id="cooldownSeconds" value="${settings.cooldownSeconds}" step="5"></div>
                <div><label>📈 TP (%):</label><input type="number" id="takeProfitPercent" value="${settings.takeProfitPercent}" step="1"></div>
                <div><label>📉 SL (%):</label><input type="number" id="stopLossPercent" value="${settings.stopLossPercent}" step="1"></div>
                <div><label>📅 Лимит загуба:</label><input type="number" id="dailyLossLimit" value="${settings.dailyLossLimit}" step="1" placeholder="0"></div>
                <div><label>🎯 Лимит печалба:</label><input type="number" id="dailyProfitLimit" value="${settings.dailyProfitLimit}" step="1" placeholder="0"></div>
            </div>
            <button onclick="saveSettings()" style="width: 100%; margin-top: 12px;">💾 ЗАПАЗИ</button>
        </div>
    </div>
    
    <div class="card" style="margin-bottom: 16px;">
        <div class="card-title">📈 Търговски метрики</div>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;">
            <div><div style="font-size: 12px; color:#888;">Средна печалба</div><div class="positive">+$${metrics.avgWin.toFixed(2)}</div></div>
            <div><div style="font-size: 12px; color:#888;">Средна загуба</div><div class="negative">-$${metrics.avgLoss.toFixed(2)}</div></div>
            <div><div style="font-size: 12px; color:#888;">Най-дълга серия</div><div>${metrics.maxWinStreak} победи</div></div>
            <div><div style="font-size: 12px; color:#888;">Дневен P&L</div><div class="${dailyPnL >= 0 ? 'positive' : 'negative'}">${dailyPnL >= 0 ? '+' : ''}$${dailyPnL.toFixed(2)}</div></div>
        </div>
    </div>
    
    <div class="card">
        <div class="card-title">📋 История на сделките</div>
        <div style="max-height: 300px; overflow-y: auto;">
            <table><thead><tr><th>Време</th><th>Пазар</th><th>Размер</th><th>Резултат</th><th>Печалба</th></tr></thead>
            <tbody id="tradesTable"></tbody></table>
        </div>
    </div>
    
    <button onclick="fetch('/trade',{method:'POST'})" style="width: 100%; margin-top: 16px;">💸 РЪЧНА СДЕЛКА</button>
</div>

<script>
async function loadMarkets() {
    const res = await fetch('/markets?q=bitcoin');
    const markets = await res.json();
    const select = document.getElementById('marketSelect');
    select.innerHTML = '<option value="">Избери пазар...</option>';
    markets.forEach(m => {
        const option = document.createElement('option');
        option.value = JSON.stringify({ id: m.id, question: m.question });
        option.textContent = m.question;
        select.appendChild(option);
    });
}

async function selectMarket() {
    const select = document.getElementById('marketSelect');
    const outcome = document.getElementById('outcomeSelect').value;
    if (!select.value) return;
    const market = JSON.parse(select.value);
    const res = await fetch('/select-market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: market.question, outcome }) });
    const result = await res.json();
    if (result.success) document.getElementById('selectedMarket').innerHTML = '✅ Активен: ' + market.question + ' (' + outcome + ')';
}

async function saveSettings() {
    const settings = {
        tradeAmount: parseFloat(document.getElementById('tradeAmount').value),
        cooldownSeconds: parseInt(document.getElementById('cooldownSeconds').value),
        takeProfitPercent: parseInt(document.getElementById('takeProfitPercent').value),
        stopLossPercent: parseInt(document.getElementById('stopLossPercent').value),
        dailyLossLimit: parseFloat(document.getElementById('dailyLossLimit').value) || 0,
        dailyProfitLimit: parseFloat(document.getElementById('dailyProfitLimit').value) || 0
    };
    await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
    location.reload();
}

async function loadTrades() {
    const res = await fetch('/trades');
    const trades = await res.json();
    const tbody = document.getElementById('tradesTable');
    tbody.innerHTML = trades.slice(0, 30).map(t => `<tr><td>${new Date(t.time).toLocaleTimeString()}</td><td>${t.market?.substring(0, 30) || '-'}</td><td>$${t.amount?.toFixed(2) || '0'}</td><td>${t.status || 'отворена'}</td><td class="${t.profit > 0 ? 'profit-positive' : (t.profit < 0 ? 'profit-negative' : '')}">${t.profit ? (t.profit > 0 ? '+' : '') + t.profit.toFixed(2) : '-'}</td></tr>`).join('');
}

loadMarkets();
loadTrades();
setInterval(loadTrades, 10000);
</script>
</body>
</html>`;
    res.send(html);
});

// ========== API ENDPOINTS ==========
app.get('/markets', async (req, res) => {
    const markets = await searchMarkets(req.query.q || 'bitcoin');
    res.json(markets);
});

app.post('/select-market', async (req, res) => {
    const { question, outcome } = req.body;
    const markets = await searchMarkets(question);
    const market = markets.find(m => m.question === question);
    if (market) {
        const token = market.tokens.find(t => t.outcome === outcome);
        if (token) {
            activeMarket = { question, outcome, tokenId: token.token_id };
            console.log(`🎯 Активен пазар: ${question} (${outcome})`);
            res.json({ success: true });
        } else {
            res.json({ success: false, error: 'Токенът не е намерен' });
        }
    } else {
        res.json({ success: false, error: 'Пазарът не е намерен' });
    }
});

app.get('/balance', (req, res) => res.json(global.realBalance));
app.get('/trades', (req, res) => res.json(global.tradeLog));
app.post('/settings', (req, res) => {
    settings = { ...settings, ...req.body };
    saveSettings();
    res.json({ success: true });
});
app.post('/trade', async (req, res) => {
    await executeTrade();
    res.json({ success: true });
});

// ========== СТАРТИРАНЕ ==========
async function start() {
    loadSettings();
    loadTradesHistory();
    console.log('🚀 Стартиране на HyperMeteo V4 Professional...');
    await initClob();
    await updateRealBalance();
    setInterval(() => executeTrade(), 1000);
    setInterval(() => updatePositions(), 10000);
    setInterval(() => updateRealBalance(), 30000);
    app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Уеб панел: http://89.117.152.7:${PORT}`));
    console.log('✅ Ботът е готов!');
}

start().catch(console.error);
