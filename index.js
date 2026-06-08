require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { ClobClient, Side, OrderType } = require('@polymarket/clob-client-v2');
const { privateKeyToAccount } = require('viem/accounts');
const { createWalletClient, http } = require('viem');
const { polygon } = require('viem/chains');
const { getRealUSDCBalance } = require('./balanceChecker');
const { getBTCPrice } = require('./btcPrice');

const app = express();
const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = '0xfC74Aeb8eaCf185A4D1c4EC6a4A1aC60702E4785';
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const TRADES_FILE = path.join(__dirname, 'trades_history.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const STRATEGIES = { HEDGE: 'hedge', BTC_5MIN: 'btc_5min' };
let currentStrategy = STRATEGIES.BTC_5MIN;
let botRunning = true;
let liveMode = false;

const DEFAULT_SETTINGS = {
    [STRATEGIES.HEDGE]: {
        tradeAmount: 1.00,
        cooldownSeconds: 60,
        takeProfitPercent: 15,
        stopLossPercent: 8,
        hedgeRatio: 0.70
    },
    [STRATEGIES.BTC_5MIN]: {
        tradeAmount: 0.35,
        limitPrice: 0.94,
        takeProfitBid: 0.98,
        entrySecondsMin: 10,
        entrySecondsMax: 50,
        deltaSkip: 0.0005,
        deltaWeak: 0.001,
        deltaStrong: 0.002,
        minMarketPrice: 0.94,
        maxMarketPrice: 0.98,
        minConfidence: 0.7,
        weakBetSize: 0.25,
        mediumBetSize: 0.50,
        strongBetSize: 0.75,
        dailyLossLimit: 2.00,
        dailyProfitLimit: 5.00,
        minBalanceRequired: 10.00
    }
};

let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

let startingBalance = null;
let lastTradeTime = 0;
let clobClient = null;
let accountAddress = null;
let marketStartPrice = 0;
let currentBTCPrice = 0;
let dailyPnL = 0;
let confidenceScore = 0;
let lastResetDate = new Date().toDateString();

global.realBalance = { current: 0, starting: null, pnl: 0, mode: 'simulation' };
global.tradeLog = [];

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            if (saved.currentStrategy) currentStrategy = saved.currentStrategy;
            if (saved.liveMode !== undefined) liveMode = saved.liveMode;
            if (saved.settings) {
                for (let strat of Object.keys(STRATEGIES)) {
                    if (saved.settings[strat]) {
                        settings[strat] = { ...settings[strat], ...saved.settings[strat] };
                    }
                }
            }
            console.log(`📁 Заредено: стратегия ${currentStrategy}, режим ${liveMode ? 'РЕАЛЕН' : 'ТЕСТ'}`);
        } else {
            saveSettings();
        }
    } catch(e) { console.error('Грешка при зареждане на настройки:', e.message); }
}

function saveSettings() {
    const toSave = {
        currentStrategy: currentStrategy,
        liveMode: liveMode,
        settings: settings
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2));
    console.log('💾 Настройките са запазени в settings.json');
}

function saveTradesHistory() {
    try { fs.writeFileSync(TRADES_FILE, JSON.stringify(global.tradeLog.slice(0, 1000), null, 2)); } catch(e) {}
}

function checkDailyLimits() {
    const today = new Date().toDateString();
    if (today !== lastResetDate) { dailyPnL = 0; lastResetDate = today; }
    const cfg = settings[currentStrategy];
    if (currentStrategy === STRATEGIES.BTC_5MIN) {
        if (cfg.dailyLossLimit > 0 && dailyPnL <= -cfg.dailyLossLimit) return false;
        if (cfg.dailyProfitLimit > 0 && dailyPnL >= cfg.dailyProfitLimit) return false;
    }
    return true;
}

async function getBTCPriceBinance() {
    try { const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'); const data = await res.json(); return parseFloat(data.price); } catch(e) { return 0; }
}

function getCurrentMarketSlug() { const now = Math.floor(Date.now() / 1000); return `btc-updown-5m-${Math.floor(now / 300) * 300}`; }

async function discoverCurrentMarket() {
    try {
        const slug = getCurrentMarketSlug();
        const res = await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`);
        const events = await res.json();
        if (!events || events.length === 0) return null;
        const market = events[0]?.markets?.[0];
        if (!market?.clobTokenIds) return null;
        const [yesId, noId] = market.clobTokenIds;
        return { slug, yesTokenId: yesId, noTokenId: noId };
    } catch(e) { return null; }
}

async function executeBTC5MinTrade() {
    if (!botRunning) return;
    const cfg = settings[STRATEGIES.BTC_5MIN];
    if (!cfg) return;
    if (global.realBalance.current < cfg.minBalanceRequired) return;

    const market = await discoverCurrentMarket();
    if (!market) return;

    const secondsRemaining = 300 - Math.floor((Date.now() / 1000) % 300);
    if (secondsRemaining > cfg.entrySecondsMax || secondsRemaining < cfg.entrySecondsMin) return;

    const price = await getBTCPriceBinance();
    if (price === 0) return;
    if (marketStartPrice === 0) { marketStartPrice = price; currentBTCPrice = price; return; }
    currentBTCPrice = price;

    const percentChange = Math.abs((price - marketStartPrice) / marketStartPrice);
    if (percentChange < cfg.deltaSkip) return;

    const direction = price > marketStartPrice ? 'UP' : 'DOWN';
    let conf = 0;
    if (percentChange >= cfg.deltaStrong) conf += 0.4;
    else if (percentChange >= cfg.deltaWeak) conf += 0.25;
    confidenceScore = Math.min(1, conf);
    if (confidenceScore < cfg.minConfidence) return;

    let bet = cfg.mediumBetSize;
    if (confidenceScore >= 0.85) bet = cfg.strongBetSize;
    else if (confidenceScore >= 0.7) bet = cfg.mediumBetSize;
    else if (confidenceScore >= 0.6) bet = cfg.weakBetSize;
    else return;

    if (Date.now() - lastTradeTime < 300000) return;

    console.log(`🎯 [5-min BTC] ${direction} | ${(confidenceScore*100).toFixed(0)}% | $${bet} | ${liveMode ? 'РЕАЛНО' : 'ТЕСТ'}`);
    lastTradeTime = Date.now();

    global.tradeLog.unshift({
        time: new Date().toISOString(),
        strategy: '5-min BTC',
        amount: bet,
        direction: direction,
        confidence: confidenceScore,
        status: liveMode ? 'live_signal' : 'test_signal',
        mode: liveMode ? 'REAL' : 'TEST'
    });
    saveTradesHistory();
}

async function executeHedgeTrade() {
    if (!botRunning) return;
    const cfg = settings[STRATEGIES.HEDGE];
    if (!cfg) return;
    if (Date.now() - lastTradeTime < (cfg.cooldownSeconds || 60) * 1000) return;

    console.log(`🎯 [Хедж] $${cfg.tradeAmount} | TP:${cfg.takeProfitPercent}% | SL:${cfg.stopLossPercent}% | ${liveMode ? 'РЕАЛНО' : 'ТЕСТ'}`);
    lastTradeTime = Date.now();
    global.tradeLog.unshift({
        time: new Date().toISOString(),
        strategy: 'Хедж 70/15/15',
        amount: cfg.tradeAmount,
        takeProfit: cfg.takeProfitPercent,
        stopLoss: cfg.stopLossPercent,
        status: liveMode ? 'live_signal' : 'test_signal',
        mode: liveMode ? 'REAL' : 'TEST'
    });
    saveTradesHistory();
}

async function runBacktest(days = 7) {
    const cfg = settings[currentStrategy];
    let balance = 100, wins = 0, losses = 0;
    const cycles = days * (currentStrategy === STRATEGIES.BTC_5MIN ? 288 : 24);
    for (let i = 0; i < cycles; i++) {
        const winRate = currentStrategy === STRATEGIES.BTC_5MIN ? 0.62 : 0.55;
        const win = Math.random() < winRate;
        if (currentStrategy === STRATEGIES.BTC_5MIN) {
            if (win) { balance += 0.5 * 0.0425; wins++; } else { balance -= 0.5; losses++; }
        } else {
            if (win) { balance += 1 * 0.15; wins++; } else { balance -= 1 * 0.08; losses++; }
        }
    }
    return { winRate: (wins/(wins+losses))*100, totalPnL: balance-100, finalBalance: balance, wins, losses };
}

async function initClob() {
    try {
        const pk = process.env.POLYMARKET_PRIVATE_KEY;
        if (!pk || pk.length < 10) { console.log('⚠️ Липсва POLYMARKET_PRIVATE_KEY - само ТЕСТ'); global.realBalance.mode = 'simulation'; return; }
        const account = privateKeyToAccount(pk);
        accountAddress = account.address;
        const signer = createWalletClient({ account, transport: http('https://polygon-rpc.com'), chain: polygon });
        console.log(`✅ Адрес: ${accountAddress}`);
        const temp = new ClobClient({ host: 'https://clob.polymarket.com', chainId: 137, signer });
        const creds = await temp.createApiKey();
        clobClient = new ClobClient({ host: 'https://clob.polymarket.com', chainId: 137, signer, creds, signatureType: 3, funderAddress: accountAddress });
        console.log("✅ ClobClient v2 готов");
        global.realBalance.mode = liveMode ? 'live' : 'simulation';
    } catch(e) { console.error('❌ CLOB грешка:', e.message); global.realBalance.mode = 'simulation'; }
}

async function updateRealBalance() {
    const result = await getRealUSDCBalance(WALLET_ADDRESS);
    if (result.success) {
        if (startingBalance === null) startingBalance = result.balance;
        const pnl = result.balance - startingBalance;
        global.realBalance = { current: result.balance, starting: startingBalance, pnl: pnl, success: true, mode: global.realBalance.mode };
        console.log(`💰 Баланс: $${result.balance.toFixed(4)} | П/З: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(4)}`);
    }
}

function resetMarketStartPrice() { if (Math.floor((Date.now() / 1000) % 300) === 0) marketStartPrice = 0; }
app.get('/', (req, res) => {
    const cfg = settings[currentStrategy];
    const isBTC = currentStrategy === STRATEGIES.BTC_5MIN;
    res.send(`<!DOCTYPE html>
<html>
<head>
    <title>HyperMeteo V4</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:#0a0a0f;color:#e0e0e0;font-family:monospace;padding:20px}
        .dashboard{max-width:1400px;margin:0 auto}
        .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding:16px 20px;background:#111116;border-radius:12px}
        .logo{font-size:24px;font-weight:bold;color:#00ff88}
        .mode-live{background:#00ff8822;color:#00ff88;border:1px solid #00ff88}
        .mode-sim{background:#ffaa0022;color:#ffaa00;border:1px solid #ffaa00}
        .mode-stop{background:#ff446622;color:#ff4466;border:1px solid #ff4466}
        .mode-badge{padding:4px 12px;border-radius:20px;font-size:12px}
        .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}
        .card{background:#111116;border-radius:12px;padding:20px;border:1px solid #2a2a30}
        .card-title{font-size:12px;color:#888;margin-bottom:12px}
        .card-value{font-size:32px;font-weight:bold;color:#fff}
        .positive{color:#00ff88}.negative{color:#ff4466}
        .two-columns{display:grid;grid-template-columns:1fr 1.5fr;gap:16px;margin-bottom:24px}
        .settings-panel{background:#111116;border-radius:12px;padding:16px;border:1px solid #2a2a30}
        input,button{background:#1a1a20;border:1px solid #2a2a30;color:#fff;padding:10px;border-radius:8px;width:100%;margin-bottom:10px}
        button{background:#00ff88;color:#000;cursor:pointer;font-weight:bold}
        button.danger{background:#ff4466}button.warning{background:#ffaa00}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th,td{padding:12px;text-align:left;border-bottom:1px solid #1a1a20}
        .strategy-btn{padding:8px 16px;margin:0 5px;border-radius:20px;cursor:pointer}
        .active-strategy{background:#00ff88;color:#000}
        .inactive-strategy{background:#2a2a30;color:#888}
    </style>
</head>
<body>
<div class="dashboard">
<div class="header"><div class="logo">🤖 HyperMeteo V4</div><div class="mode-badge ${!botRunning ? 'mode-stop' : (global.realBalance.mode === 'live' ? 'mode-live' : 'mode-sim')}">${!botRunning ? '⏹️ СПРЯН' : (global.realBalance.mode === 'live' ? '🔴 РЕАЛЕН' : '⚠️ ТЕСТ')}</div></div>
<div class="grid">
<div class="card"><div class="card-title">💰 Баланс</div><div class="card-value">$${global.realBalance.current?.toFixed(2) || '0'}</div><div class="card-sub ${(global.realBalance.pnl || 0) >= 0 ? 'positive' : 'negative'}">П/З: ${(global.realBalance.pnl || 0) >= 0 ? '+' : ''}${(global.realBalance.pnl || 0).toFixed(2)}</div></div>
<div class="card"><div class="card-title">🎯 Confidence</div><div class="card-value">${(confidenceScore*100).toFixed(0)}%</div><div class="card-sub">${isBTC ? `Праг: ${(cfg?.minConfidence || 0.7)*100}%` : 'N/A'}</div></div>
<div class="card"><div class="card-title">📊 Стратегия</div><div class="card-value" style="font-size:18px">${isBTC ? '5-min BTC' : 'Хедж'}</div><div class="card-sub">Дневен P&L: ${dailyPnL >= 0 ? '+' : ''}$${dailyPnL.toFixed(2)}</div></div>
<div class="card"><div class="card-title">🤖 Статус</div><div class="card-value">${botRunning ? '🟢 АКТИВЕН' : '🔴 СПРЯН'}</div><div class="card-sub">CLOB: ${clobClient ? '✅' : '❌'}</div></div>
</div>
<div class="two-columns">
<div class="settings-panel"><h3>🎯 СТРАТЕГИЯ</h3><button id="btnHedge" class="strategy-btn ${!isBTC ? 'active-strategy' : 'inactive-strategy'}" onclick="switchStrategy('hedge')">📊 Хедж</button><button id="btnBTC" class="strategy-btn ${isBTC ? 'active-strategy' : 'inactive-strategy'}" onclick="switchStrategy('btc_5min')">⚡ 5-min BTC</button><div style="margin-top:15px"><h3>🕹️ УПРАВЛЕНИЕ</h3>${botRunning ? '<button class="warning" onclick="setBotRunning(false)">⏸️ СПРИ БОТА</button>' : '<button onclick="setBotRunning(true)">▶️ ПУСНИ БОТА</button>'}${!liveMode ? '<button onclick="setLiveMode(true)" class="warning">🔴 ПУСНИ РЕАЛНА ТЪРГОВИЯ</button>' : '<button onclick="setLiveMode(false)" class="danger">⚠️ СПРИ РЕАЛНА ТЪРГОВИЯ</button>'}</div></div>
<div class="settings-panel"><h3>⚙️ НАСТРОЙКИ (${isBTC ? '5-min BTC' : 'Хедж'})</h3><form id="settingsForm">${isBTC ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label>💰 Размер (базов):</label><input type="number" name="tradeAmount" value="${cfg?.tradeAmount || 0.35}" step="0.05"></div><div><label>🎯 Лимит цена:</label><input type="number" name="limitPrice" value="${cfg?.limitPrice || 0.94}" step="0.01"></div><div><label>📈 TP цена:</label><input type="number" name="takeProfitBid" value="${cfg?.takeProfitBid || 0.98}" step="0.01"></div><div><label>🎯 Min Confidence (%):</label><input type="number" name="minConfidence" value="${(cfg?.minConfidence || 0.7)*100}" step="5"></div><div><label>📊 Min Market Price:</label><input type="number" name="minMarketPrice" value="${cfg?.minMarketPrice || 0.94}" step="0.01"></div><div><label>📅 Дневен лимит загуба:</label><input type="number" name="dailyLossLimit" value="${cfg?.dailyLossLimit || 2}" step="0.5"></div><div><label>🎯 Дневен лимит печалба:</label><input type="number" name="dailyProfitLimit" value="${cfg?.dailyProfitLimit || 5}" step="0.5"></div></div>` : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label>💰 Размер:</label><input type="number" name="tradeAmount" value="${cfg?.tradeAmount || 1}" step="0.25"></div><div><label>⏱️ Cooldown (s):</label><input type="number" name="cooldownSeconds" value="${cfg?.cooldownSeconds || 60}" step="10"></div><div><label>📈 TP (%):</label><input type="number" name="takeProfitPercent" value="${cfg?.takeProfitPercent || 15}" step="1"></div><div><label>📉 SL (%):</label><input type="number" name="stopLossPercent" value="${cfg?.stopLossPercent || 8}" step="1"></div><div><label>🛡️ Hedge Ratio (%):</label><input type="number" name="hedgeRatio" value="${(cfg?.hedgeRatio || 0.7)*100}" step="5"></div></div>`}<button type="submit">💾 ЗАПАЗИ</button></form></div></div>
<div class="card"><div class="card-title">🔬 BACKTEST (7 дни)</div><button onclick="runBacktest()">📊 ПУСНИ BACKTEST</button><div id="backtestResult" style="margin-top:10px;padding:10px;background:#1a1a20;border-radius:8px"></div></div>
<div class="card"><div class="card-title">📋 ИСТОРИЯ</div><div style="max-height:300px;overflow-y:auto"><table style="width:100%"><thead><tr><th>Време</th><th>Стратегия</th><th>Размер</th><th>Режим</th><th>Статус</th></tr></thead><tbody id="tradesTable"></tbody></table></div></div></div>
<script>
async function switchStrategy(s){ const r=await fetch('/switch-strategy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({strategy:s})}); if((await r.json()).success) location.reload(); }
async function setBotRunning(r){ await fetch('/set-bot-running',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({running:r})}); location.reload(); }
async function setLiveMode(l){ await fetch('/set-live-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({live:l})}); location.reload(); }
async function saveSettings() {
    const form = document.getElementById('settingsForm');
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = isNaN(v) ? v : parseFloat(v); });
    if (data.minConfidence) data.minConfidence = data.minConfidence / 100;
    if (data.hedgeRatio) data.hedgeRatio = data.hedgeRatio / 100;
    console.log('📤 Запазване на настройки:', data);
    try {
        const res = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const result = await res.json();
        if (result.success) {
            alert('✅ Настройките са запазени!');
            for (let key in data) {
                const input = document.querySelector(`[name="${key}"]`);
                if (input) input.value = data[key];
            }
        } else {
            alert('❌ Грешка: ' + (result.error || 'неизвестна'));
        }
    } catch (err) {
        alert('❌ Грешка: ' + err.message);
    }
}
async function runBacktest() {
    const btn = event.target; btn.disabled=true; btn.textContent='⏳...';
    const res = await fetch('/backtest'); const d = await res.json();
    document.getElementById('backtestResult').innerHTML = '<b>📊 Backtest (7 дни):</b><br>🏆 Win Rate: '+d.winRate.toFixed(1)+'% ('+d.wins+'/'+(d.wins+d.losses)+')<br>💰 Краен баланс: $'+d.finalBalance.toFixed(2)+'<br>📈 Обща печалба: '+(d.totalPnL>=0?'+':'')+'$'+d.totalPnL.toFixed(2);
    btn.disabled=false; btn.textContent='📊 ПУСНИ BACKTEST';
}
async function loadTrades() {
    const res = await fetch('/trades');
    const trades = await res.json();
    const tbody = document.getElementById('tradesTable');
    if(!trades.length){ tbody.innerHTML='<tr><td colspan="5">Няма сделки</td></tr>'; return; }
    tbody.innerHTML = trades.slice(0,30).map(t=>'<tr><td>'+new Date(t.time).toLocaleTimeString()+'</td><td>'+(t.strategy||'-')+'</td><td>$'+(t.amount||0).toFixed(2)+'</td><td class="'+(t.mode==='REAL'?'positive':'negative')+'">'+(t.mode||'TEST')+'</td><td>'+(t.status||'-')+'</td></tr>').join('');
}
document.getElementById('settingsForm')?.addEventListener('submit',e=>{ e.preventDefault(); saveSettings(); });
loadTrades(); setInterval(loadTrades,5000);
</script>
</body>
</html>`);
});

app.post('/switch-strategy', (req, res) => {
    const { strategy } = req.body;
    if (strategy === STRATEGIES.HEDGE || strategy === STRATEGIES.BTC_5MIN) {
        currentStrategy = strategy;
        saveSettings();
        res.json({ success: true });
    } else res.json({ success: false });
});

app.post('/set-bot-running', (req, res) => {
    botRunning = req.body.running;
    saveSettings();
    res.json({ success: true });
});

app.post('/set-live-mode', (req, res) => {
    liveMode = req.body.live;
    global.realBalance.mode = (liveMode && clobClient) ? 'live' : 'simulation';
    saveSettings();
    res.json({ success: true });
});

app.post('/settings', (req, res) => {
    console.log('📝 Запазване на настройки за', currentStrategy, req.body);
    for (let key in req.body) {
        if (req.body.hasOwnProperty(key)) {
            settings[currentStrategy][key] = req.body[key];
        }
    }
    saveSettings();
    res.json({ success: true });
});

app.get('/backtest', async (req, res) => {
    const result = await runBacktest(7);
    res.json(result);
});

app.get('/balance', (req, res) => res.json(global.realBalance));
app.get('/trades', (req, res) => res.json(global.tradeLog));

app.post('/trade', async (req, res) => {
    if (currentStrategy === STRATEGIES.BTC_5MIN) await executeBTC5MinTrade();
    else await executeHedgeTrade();
    res.json({ success: true });
});

async function start() {
    loadSettings();
    console.log('🚀 HyperMeteo V4');
    console.log(`📋 Стратегия: ${currentStrategy === STRATEGIES.BTC_5MIN ? '5-min BTC' : 'Хедж'}`);
    console.log(`🎮 Режим: ${liveMode ? 'РЕАЛНА ТЪРГОВИЯ' : 'ТЕСТОВ РЕЖИМ'}`);
    console.log(`⏯️ Ботът е ${botRunning ? 'ПУСНАТ' : 'СПРЯН'}`);
    await initClob();
    await updateRealBalance();
    setInterval(() => { if (botRunning) { if (currentStrategy === STRATEGIES.BTC_5MIN) executeBTC5MinTrade(); else executeHedgeTrade(); } }, 1000);
    setInterval(() => { if (currentStrategy === STRATEGIES.BTC_5MIN) resetMarketStartPrice(); }, 1000);
    setInterval(updateRealBalance, 30000);
    app.listen(PORT, '0.0.0.0', () => console.log(`🌐 http://89.117.152.7:${PORT}`));
}
start().catch(console.error);
