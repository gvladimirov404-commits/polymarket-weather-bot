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
const BALANCE_HISTORY_FILE = path.join(__dirname, 'balance_history.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== НАСТРОЙКИ ==========
let settings = {
    marketName: 'Will bitcoin hit $1m before GTA VI?',
    tokenOutcome: 'Yes',
    tradeAmount: 1.00,
    cooldownSeconds: 60,
    takeProfitPercent: 15,
    stopLossPercent: 8,
    dailyLossLimit: 0,      // 0 = неактивен
    dailyProfitLimit: 0,    // 0 = неактивен
    trailingStopPercent: 0, // 0 = неактивен
    useKellyCriterion: false,
    kellyFraction: 0.25
};

// История на сделките
let tradesHistory = [];
let balanceHistory = [];
let dailyStats = { date: new Date().toDateString(), loss: 0, profit: 0, trades: 0 };
let openPositions = [];

// Метрики
let metrics = {
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    longestWinStreak: 0,
    currentWinStreak: 0,
    longestLossStreak: 0,
    maxDrawdown: 0,
    peakBalance: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0
};

function loadData() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
        if (fs.existsSync(TRADES_FILE)) tradesHistory = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
        if (fs.existsSync(BALANCE_HISTORY_FILE)) balanceHistory = JSON.parse(fs.readFileSync(BALANCE_HISTORY_FILE, 'utf8'));
        console.log('📁 Данните са заредени');
    } catch (error) {}
}

function saveData() {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    fs.writeFileSync(TRADES_FILE, JSON.stringify(tradesHistory.slice(-500), null, 2));
    fs.writeFileSync(BALANCE_HISTORY_FILE, JSON.stringify(balanceHistory.slice(-1000), null, 2));
}

function updateMetrics() {
    const closedTrades = tradesHistory.filter(t => t.status === 'tp_hit' || t.status === 'sl_hit');
    const wins = closedTrades.filter(t => t.pnl > 0);
    const losses = closedTrades.filter(t => t.pnl < 0);
    
    metrics.totalTrades = closedTrades.length;
    metrics.winningTrades = wins.length;
    metrics.losingTrades = losses.length;
    metrics.winRate = metrics.totalTrades > 0 ? (wins.length / metrics.totalTrades * 100) : 0;
    metrics.avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    metrics.avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
    
    // Streak анализ
    let currentStreak = 0, maxStreak = 0, currentLossStreak = 0, maxLossStreak = 0;
    for (const trade of closedTrades.slice(-50)) {
        if (trade.pnl > 0) { currentStreak++; currentLossStreak = 0; }
        else { currentLossStreak++; currentStreak = 0; }
        maxStreak = Math.max(maxStreak, currentStreak);
        maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    }
    metrics.longestWinStreak = maxStreak;
    metrics.longestLossStreak = maxLossStreak;
    
    // Drawdown анализ
    let peak = 0, maxDD = 0;
    for (const bal of balanceHistory) {
        if (bal.balance > peak) peak = bal.balance;
        const dd = peak > 0 ? (peak - bal.balance) / peak * 100 : 0;
        maxDD = Math.max(maxDD, dd);
    }
    metrics.maxDrawdown = maxDD;
    metrics.peakBalance = metrics.peakBalance > 0 ? metrics.peakBalance : (balanceHistory[balanceHistory.length-1]?.balance || 0);
}

// ========== ОТКРИВАНЕ НА TOKEN ID ==========
async function getMarketTokenId() {
    try {
        const response = await fetch('https://gamma-api.polymarket.com/markets?limit=200');
        const markets = await response.json();
        const market = markets.find(m => m.question === settings.marketName);
        if (!market) return null;
        const token = market.tokens.find(t => t.outcome === settings.tokenOutcome);
        return token ? token.token_id : null;
    } catch (error) {
        return null;
    }
}

// ========== ИНИЦИАЛИЗАЦИЯ НА CLOB ==========
let clobClient = null;
let accountAddress = null;
let marketTokenId = null;

async function initClob() {
    try {
        const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
        if (!privateKey) { console.log('⚠️ Липсва ключ - симулация'); return; }
        const account = privateKeyToAccount(privateKey);
        accountAddress = account.address;
        const signer = createWalletClient({ account, transport: http('https://polygon-rpc.com'), chain: polygon });
        console.log(`✅ Адрес: ${accountAddress}`);
        const tempClient = new ClobClient({ host: 'https://clob.polymarket.com', chainId: 137, signer });
        const apiCreds = await tempClient.createApiKey();
        clobClient = new ClobClient({ host: 'https://clob.polymarket.com', chainId: 137, signer, creds: apiCreds, signatureType: 3, funderAddress: accountAddress });
        console.log("✅ ClobClient v2 готов");
        marketTokenId = await getMarketTokenId();
        if (marketTokenId) console.log(`🎯 Пазар: ${settings.marketName} (${settings.tokenOutcome})`);
        else console.log(`⚠️ Token ID не е намерен`);
        return true;
    } catch (error) {
        console.error('❌ CLOB грешка:', error.message);
        return false;
    }
}

// ========== ОСТАНАЛИТЕ ФУНКЦИИ (UPDATE BALANCE, EXECUTE TRADE, ЕНДПОЙНТИ) ==========
// ⚠️ ПРОДЪЛЖЕНИЕ СЛЕДВА В ЧАСТ 2...
// ========== ПРОДЪЛЖЕНИЕ ОТ ЧАСТ 1 ==========

async function updateRealBalance() {
    const result = await getRealUSDCBalance(WALLET_ADDRESS);
    if (result.success && result.balance !== global.realBalance?.current) {
        balanceHistory.push({ time: new Date().toISOString(), balance: result.balance });
        if (balanceHistory.length > 1000) balanceHistory.shift();
        saveData();
    }
    if (result.success) {
        if (startingBalance === null) startingBalance = result.balance;
        const pnl = result.balance - startingBalance;
        global.realBalance = { current: result.balance, starting: startingBalance, pnl, success: true };
        if (result.balance > metrics.peakBalance) metrics.peakBalance = result.balance;
        updateMetrics();
        console.log(`💰 Баланс: ${result.balance.toFixed(4)} USDC | П/З: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)}`);
    }
}

async function executeTrade() {
    const now = Date.now();
    if (now - lastTradeTime < settings.cooldownSeconds * 1000) return;
    
    // Дневен лимит
    const today = new Date().toDateString();
    if (dailyStats.date !== today) dailyStats = { date: today, loss: 0, profit: 0, trades: 0 };
    if (settings.dailyLossLimit > 0 && dailyStats.loss >= settings.dailyLossLimit) return;
    if (settings.dailyProfitLimit > 0 && dailyStats.profit >= settings.dailyProfitLimit) return;
    
    // Kelly Criterion
    let tradeAmount = settings.tradeAmount;
    if (settings.useKellyCriterion && metrics.winRate > 0 && metrics.avgWin > 0) {
        const kelly = (metrics.winRate/100 * metrics.avgWin - (1 - metrics.winRate/100) * metrics.avgLoss) / metrics.avgWin;
        const kellyFraction = Math.max(0, Math.min(0.5, kelly * settings.kellyFraction));
        tradeAmount = Math.max(0.5, Math.min(5.0, global.realBalance.current * kellyFraction));
    }
    
    lastTradeTime = now;
    console.log(`🚀 СДЕЛКА: $${tradeAmount.toFixed(2)} USDC | TP: ${settings.takeProfitPercent}% | SL: ${settings.stopLossPercent}%`);
    
    if (clobClient && marketTokenId) {
        try {
            const response = await clobClient.createAndPostMarketOrder(
                { tokenID: marketTokenId, amount: tradeAmount, side: Side.BUY, orderType: OrderType.FOK },
                { tickSize: "0.01" }, OrderType.FOK
            );
            console.log(`✅ РЕАЛЕН ордер изпратен!`);
            tradesHistory.unshift({ time: new Date().toISOString(), amount: tradeAmount, market: settings.marketName, outcome: settings.tokenOutcome, status: 'open', entryPrice: 0, pnl: 0, tp: settings.takeProfitPercent, sl: settings.stopLossPercent });
            openPositions.push({ tokenId: marketTokenId, amount: tradeAmount, entryTime: new Date().toISOString(), entryPrice: 0, tp: settings.takeProfitPercent, sl: settings.stopLossPercent });
        } catch (error) {
            console.error('❌ Грешка:', error.message);
        }
    } else {
        console.log('⚠️ СИМУЛАЦИЯ');
        tradesHistory.unshift({ time: new Date().toISOString(), amount: tradeAmount, market: settings.marketName, status: 'simulated', pnl: 0 });
    }
    saveData();
    setTimeout(() => updateRealBalance(), 5000);
}

let startingBalance = null;
let lastTradeTime = 0;
global.realBalance = { current: 0, starting: null, pnl: 0 };

// ========== УЕБ ПАНЕЛ (HTML + CSS + JS) ==========
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>HyperMeteo V4 | Polymarket Trading Bot</title>
        <meta charset="UTF-8">
        <meta http-equiv="refresh" content="15">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { background: #0a0a0c; font-family: 'Inter', -apple-system, BlinkMacSystemFont, monospace; color: #e0e0e0; padding: 20px; }
            .container { max-width: 1400px; margin: 0 auto; }
            
            /* Header */
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px; }
            .logo h1 { font-size: 24px; font-weight: 600; background: linear-gradient(135deg, #00ff88, #00aaff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
            .mode-badge { padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; }
            .mode-live { background: #00ff8822; color: #00ff88; border: 1px solid #00ff88; }
            .mode-sim { background: #ffaa0022; color: #ffaa00; border: 1px solid #ffaa00; }
            
            /* Grid */
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-bottom: 20px; }
            .card { background: #141418; border-radius: 16px; padding: 20px; border: 1px solid #2a2a30; transition: all 0.2s; }
            .card:hover { border-color: #00ff8844; }
            .card-header { font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
            
            /* Balance */
            .balance-main { font-size: 42px; font-weight: 700; background: linear-gradient(135deg, #fff, #00ff88); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            .pnl-positive { color: #00ff88; }
            .pnl-negative { color: #ff4466; }
            
            /* Metrics */
            .metric-value { font-size: 28px; font-weight: 600; }
            .metric-label { font-size: 12px; color: #888; margin-top: 4px; }
            .metric-row { display: flex; justify-content: space-between; margin-top: 12px; padding-top: 12px; border-top: 1px solid #2a2a30; }
            
            /* Forms */
            input, select { background: #1e1e24; border: 1px solid #2a2a30; color: #e0e0e0; padding: 8px 12px; border-radius: 8px; font-size: 14px; width: 100%; margin-top: 4px; }
            input:focus, select:focus { outline: none; border-color: #00ff88; }
            button { background: #00ff88; color: #000; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 14px; }
            button:hover { background: #00cc66; transform: translateY(-1px); }
            .btn-secondary { background: #2a2a30; color: #e0e0e0; }
            .btn-secondary:hover { background: #3a3a40; }
            
            /* Trade table */
            .trade-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #2a2a30; font-size: 13px; }
            .trade-positive { color: #00ff88; }
            .trade-negative { color: #ff4466; }
            
            /* Settings form */
            .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
            
            @media (max-width: 768px) { .settings-grid { grid-template-columns: 1fr; } .balance-main { font-size: 28px; } }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo"><h1>🤖 HyperMeteo V4</h1><div style="font-size: 12px; color: #888;">Polymarket Trading Bot</div></div>
                <div><span class="mode-badge mode-live" id="modeBadge">● РЕАЛЕН РЕЖИМ</span></div>
            </div>
            
            <div class="grid">
                <!-- Баланс и P&L -->
                <div class="card">
                    <div class="card-header">💰 ПОРТФЕЙЛ</div>
                    <div class="balance-main" id="balance">0.00 USDC</div>
                    <div style="margin-top: 8px;"><span id="pnl">+0.00</span> <span style="color:#888;">(общо)</span></div>
                    <div style="margin-top: 16px; display: flex; gap: 16px;">
                        <div><div style="font-size:12px; color:#888;">Днес</div><div id="dailyPnl">0.00</div></div>
                        <div><div style="font-size:12px; color:#888;">Сделки днес</div><div id="dailyTrades">0</div></div>
                    </div>
                </div>
                
                <!-- Отворени позиции -->
                <div class="card">
                    <div class="card-header">📊 ОТВОРЕНИ ПОЗИЦИИ</div>
                    <div id="openPositions">Няма отворени позиции</div>
                </div>
                
                <!-- Метрики -->
                <div class="card">
                    <div class="card-header">📈 СТАТИСТИКА</div>
                    <div class="metric-row"><span>Win Rate</span><span id="winRate">0%</span></div>
                    <div class="metric-row"><span>Ср. Печалба</span><span id="avgWin">0 USDC</span></div>
                    <div class="metric-row"><span>Ср. Загуба</span><span id="avgLoss">0 USDC</span></div>
                    <div class="metric-row"><span>Най-дълга серия</span><span id="longestStreak">0</span></div>
                    <div class="metric-row"><span>Max Drawdown</span><span id="maxDrawdown">0%</span></div>
                </div>
            </div>
            
            <div class="grid">
                <!-- Настройки -->
                <div class="card">
                    <div class="card-header">⚙️ НАСТРОЙКИ</div>
                    <form id="settingsForm" class="settings-grid">
                        <div><label>Пазар</label><input type="text" name="marketName" value="${settings.marketName}"></div>
                        <div><label>Outcome</label><select name="tokenOutcome"><option>Yes</option><option>No</option></select></div>
                        <div><label>Размер (USDC)</label><input type="number" name="tradeAmount" step="0.25" value="${settings.tradeAmount}"></div>
                        <div><label>Cooldown (сек)</label><input type="number" name="cooldownSeconds" step="5" value="${settings.cooldownSeconds}"></div>
                        <div><label>TP (%)</label><input type="number" name="takeProfitPercent" step="1" value="${settings.takeProfitPercent}"></div>
                        <div><label>SL (%)</label><input type="number" name="stopLossPercent" step="1" value="${settings.stopLossPercent}"></div>
                        <div><label>Дневен лимит загуба</label><input type="number" name="dailyLossLimit" step="1" value="${settings.dailyLossLimit}"></div>
                        <div><label>Trailing Stop (%)</label><input type="number" name="trailingStopPercent" step="0.5" value="${settings.trailingStopPercent}"></div>
                        <div><label>Kelly Criterion</label><select name="useKellyCriterion"><option value="true">Вкл</option><option value="false">Изкл</option></select></div>
                        <div><button type="submit">💾 ЗАПАЗИ</button></div>
                    </form>
                </div>
                
                <!-- История на сделките -->
                <div class="card" style="grid-column: span 2;">
                    <div class="card-header">📋 ПОСЛЕДНИ СДЕЛКИ</div>
                    <div id="tradesList">Зареждане...</div>
                </div>
            </div>
            
            <div style="display: flex; gap: 12px; margin-top: 20px;">
                <button onclick="fetch('/trade',{method:'POST'})">💸 РЪЧНА СДЕЛКА</button>
                <button class="btn-secondary" onclick="location.reload()">🔄 ОПРЕСНИ</button>
            </div>
        </div>
        
        <script>
            async function loadData() {
                const [balanceRes, metricsRes, tradesRes, positionsRes] = await Promise.all([
                    fetch('/balance'), fetch('/metrics'), fetch('/trades'), fetch('/positions')
                ]);
                const balance = await balanceRes.json();
                const metrics = await metricsRes.json();
                const trades = await tradesRes.json();
                const positions = await positionsRes.json();
                
                document.getElementById('balance').innerHTML = (balance.current || 0).toFixed(4) + ' USDC';
                const pnlElem = document.getElementById('pnl');
                pnlElem.innerHTML = (balance.pnl >= 0 ? '+' : '') + balance.pnl.toFixed(4);
                pnlElem.className = balance.pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
                
                document.getElementById('winRate').innerHTML = metrics.winRate?.toFixed(1) + '%' || '0%';
                document.getElementById('avgWin').innerHTML = (metrics.avgWin || 0).toFixed(2) + ' USDC';
                document.getElementById('avgLoss').innerHTML = (metrics.avgLoss || 0).toFixed(2) + ' USDC';
                document.getElementById('longestStreak').innerHTML = metrics.longestWinStreak || 0;
                document.getElementById('maxDrawdown').innerHTML = (metrics.maxDrawdown || 0).toFixed(1) + '%';
                
                if (positions.length > 0) {
                    document.getElementById('openPositions').innerHTML = positions.map(p => 
                        '<div class="trade-row"><span>' + new Date(p.entryTime).toLocaleTimeString() + '</span><span>$' + p.amount.toFixed(2) + '</span><span>TP: ' + p.tp + '% | SL: ' + p.sl + '%</span></div>'
                    ).join('');
                } else {
                    document.getElementById('openPositions').innerHTML = 'Няма отворени позиции';
                }
                
                if (trades.length > 0) {
                    document.getElementById('tradesList').innerHTML = trades.slice(0, 20).map(t => 
                        '<div class="trade-row"><span>' + new Date(t.time).toLocaleTimeString() + '</span><span>$' + t.amount.toFixed(2) + '</span><span>' + t.market + '</span><span class="' + (t.pnl > 0 ? 'trade-positive' : (t.pnl < 0 ? 'trade-negative' : '')) + '">' + (t.pnl ? (t.pnl >=0 ? '+' : '') + t.pnl.toFixed(2) : t.status) + '</span></div>'
                    ).join('');
                } else {
                    document.getElementById('tradesList').innerHTML = 'Няма сделки';
                }
            }
            
            document.getElementById('settingsForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const data = Object.fromEntries(new FormData(e.target));
                data.useKellyCriterion = data.useKellyCriterion === 'true';
                data.tradeAmount = parseFloat(data.tradeAmount);
                data.cooldownSeconds = parseInt(data.cooldownSeconds);
                data.takeProfitPercent = parseInt(data.takeProfitPercent);
                data.stopLossPercent = parseInt(data.stopLossPercent);
                data.dailyLossLimit = parseFloat(data.dailyLossLimit);
                data.trailingStopPercent = parseFloat(data.trailingStopPercent);
                await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
                location.reload();
            });
            
            loadData();
            setInterval(loadData, 10000);
        </script>
    </body>
    </html>
    `);
});

// API ендпойнти
app.get('/balance', (req, res) => res.json(global.realBalance));
app.get('/trades', (req, res) => res.json(tradesHistory.slice(0, 50)));
app.get('/positions', (req, res) => res.json(openPositions));
app.get('/metrics', (req, res) => res.json(metrics));
app.post('/settings', (req, res) => {
    Object.assign(settings, req.body);
    saveData();
    res.json({ success: true });
});
app.post('/trade', async (req, res) => { await executeTrade(); res.json({ success: true }); });

// ========== СТАРТ ==========
async function start() {
    loadData();
    console.log('🚀 HyperMeteo V4 - Hyperliquid Style');
    await initClob();
    await updateRealBalance();
    setInterval(() => executeTrade(), 1000);
    setInterval(() => updateRealBalance(), 30000);
    app.listen(PORT, '0.0.0.0', () => console.log(`🌐 http://89.117.152.7:${PORT}`));
}
start().catch(console.error);
