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
    marketName: '',
    marketTokenId: '',
    tokenOutcome: 'Yes',
    tradeAmount: 0.35,
    cooldownSeconds: 60,
    takeProfitPercent: 8,
    stopLossPercent: 4,
    dailyLossLimit: 2.00,      // Дневен лимит на загуба в USDC
    useKellyCriterion: true,    // Включване на Kelly Criterion
    kellyFraction: 0.25         // Дроб на Kelly (консервативен вариант)
};

let tradesHistory = [];
let balanceHistory = [];
let dailyStats = { date: new Date().toDateString(), loss: 0, profit: 0, trades: 0 };
let clobClient = null;
let accountAddress = null;
let startingBalance = null;
let lastTradeTime = 0;
let currentBalance = 0;
let metrics = { winRate: 50, avgWin: 0.15, avgLoss: 0.08 }; // Начални приблизителни стойности

global.realBalance = { current: 0, starting: null, pnl: 0 };

// ========== ЗАРЕЖДАНЕ И ЗАПАЗВАНЕ ==========
function loadData() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
        if (fs.existsSync(TRADES_FILE)) tradesHistory = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
        if (fs.existsSync(BALANCE_HISTORY_FILE)) balanceHistory = JSON.parse(fs.readFileSync(BALANCE_HISTORY_FILE, 'utf8'));
        console.log('📁 Данните са заредени');
        updateMetricsFromTrades();
    } catch (error) {}
}

function saveData() {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    fs.writeFileSync(TRADES_FILE, JSON.stringify(tradesHistory.slice(-500), null, 2));
    fs.writeFileSync(BALANCE_HISTORY_FILE, JSON.stringify(balanceHistory.slice(-500), null, 2));
}

function updateMetricsFromTrades() {
    const closedTrades = tradesHistory.filter(t => t.pnl !== undefined && t.pnl !== 0);
    const wins = closedTrades.filter(t => t.pnl > 0);
    const losses = closedTrades.filter(t => t.pnl < 0);
    if (closedTrades.length > 0) {
        metrics.winRate = (wins.length / closedTrades.length) * 100;
        metrics.avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
        metrics.avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
    }
}

function updateDailyStats(pnl) {
    const today = new Date().toDateString();
    if (dailyStats.date !== today) {
        dailyStats = { date: today, loss: 0, profit: 0, trades: 0 };
    }
    if (pnl < 0) dailyStats.loss += Math.abs(pnl);
    if (pnl > 0) dailyStats.profit += pnl;
    dailyStats.trades++;
    saveData();
}

function calculateKellyAmount() {
    if (!settings.useKellyCriterion) return settings.tradeAmount;
    const p = metrics.winRate / 100;
    const b = metrics.avgWin / metrics.avgLoss;
    if (b === 0 || p === 0) return Math.min(settings.tradeAmount, currentBalance * 0.02);
    const kelly = (p * b - (1 - p)) / b;
    const fraction = Math.max(0, Math.min(0.5, kelly * settings.kellyFraction));
    const KellyAmount = currentBalance * fraction;
    return Math.min(Math.max(0.35, KellyAmount), 2.00);
}

// ========== ИНИЦИАЛИЗАЦИЯ НА CLOB (ДВУСТЕПЕННА) ==========
async function initClob() {
    try {
        const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
        if (!privateKey || privateKey.length < 10) {
            console.log('⚠️ Липсва POLYMARKET_PRIVATE_KEY - симулационен режим');
            return false;
        }
        const account = privateKeyToAccount(privateKey);
        accountAddress = account.address;
        const signer = createWalletClient({ account, transport: http('https://polygon-rpc.com'), chain: polygon });
        console.log(`✅ Адрес: ${accountAddress}`);
        const tempClient = new ClobClient({ host: 'https://clob.polymarket.com', chainId: 137, signer });
        const apiCreds = await tempClient.createApiKey();
        clobClient = new ClobClient({ host: 'https://clob.polymarket.com', chainId: 137, signer, creds: apiCreds, signatureType: 3, funderAddress: accountAddress });
        console.log("✅ ClobClient v2 инициализиран - ГОТОВ ЗА РЕАЛНИ ОРДЕРИ");
        return true;
    } catch (error) {
        console.error('❌ CLOB грешка (v2):', error.message);
        return false;
    }
}

// ========== БАЛАНС ==========
async function updateRealBalance() {
    const result = await getRealUSDCBalance(WALLET_ADDRESS);
    if (result.success) {
        currentBalance = result.balance;
        if (startingBalance === null) startingBalance = result.balance;
        const pnl = result.balance - startingBalance;
        global.realBalance = { current: result.balance, starting: startingBalance, pnl, success: true };
        balanceHistory.push({ time: new Date().toISOString(), balance: result.balance });
        if (balanceHistory.length > 500) balanceHistory.shift();
        saveData();
        console.log(`💰 Баланс: ${result.balance.toFixed(4)} USDC | П/З: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)}`);
    }
}

// ========== СДЕЛКА С ДНЕВЕН ЛИМИТ И KELLY ==========
async function executeTrade() {
    const now = Date.now();
    if (now - lastTradeTime < settings.cooldownSeconds * 1000) return;
    if (!settings.marketTokenId) { console.log('⚠️ Няма избран пазар'); return; }
    
    // Дневен лимит за загуба
    if (settings.dailyLossLimit > 0 && dailyStats.loss >= settings.dailyLossLimit) {
        console.log(`⛔ Дневният лимит за загуба е достигнат (${dailyStats.loss.toFixed(2)}/${settings.dailyLossLimit} USDC). Търговията е спряна до утре.`);
        return;
    }
    
    const tradeAmount = calculateKellyAmount();
    lastTradeTime = now;
    console.log(`🚀 СДЕЛКА: $${tradeAmount.toFixed(2)} USDC (Kelly: ${settings.useKellyCriterion ? 'активен' : 'изкл'}) | ${settings.marketName}`);
    
    if (clobClient) {
        try {
            await clobClient.createAndPostMarketOrder(
                { tokenID: settings.marketTokenId, amount: tradeAmount, side: Side.BUY, orderType: OrderType.FOK },
                { tickSize: "0.01" }, OrderType.FOK
            );
            console.log(`✅ РЕАЛЕН ордер изпратен!`);
            tradesHistory.unshift({ time: new Date().toISOString(), amount: tradeAmount, market: settings.marketName, status: 'open' });
        } catch (error) {
            console.error('❌ Грешка при ордер:', error.message);
        }
    } else {
        console.log('⚠️ СИМУЛАЦИЯ (няма CLOB)');
        tradesHistory.unshift({ time: new Date().toISOString(), amount: tradeAmount, market: settings.marketName, status: 'simulated' });
    }
    saveData();
    setTimeout(() => updateRealBalance(), 5000);
}

// ========== API ТЪРСЕНЕ НА ПАЗАРИ ==========
app.get('/api/search-markets', async (req, res) => {
    const query = req.query.q?.toLowerCase() || '';
    try {
        const response = await fetch('https://gamma-api.polymarket.com/markets?limit=200&active=true');
        const markets = await response.json();
        const filtered = markets.filter(m => m.question?.toLowerCase().includes(query));
        const results = filtered.slice(0, 30).map(m => ({
            id: m.id,
            question: m.question,
            outcomes: m.outcomes,
            tokens: m.tokens.map(t => ({ outcome: t.outcome, tokenId: t.token_id }))
        }));
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== УЕБ ПАНЕЛ ==========
app.get('/', (req, res) => {
    const balanceHistoryJson = JSON.stringify(balanceHistory.slice(-100));
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>HyperMeteo V4</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { background: #0a0a0c; font-family: 'Inter', monospace; color: #e0e0e0; padding: 20px; }
            .container { max-width: 1400px; margin: 0 auto; }
            .card { background: #141418; border-radius: 16px; padding: 20px; margin-bottom: 20px; border: 1px solid #2a2a30; }
            .card-header { font-size: 14px; font-weight: 500; color: #888; margin-bottom: 16px; text-transform: uppercase; }
            .balance-main { font-size: 42px; font-weight: 700; background: linear-gradient(135deg, #fff, #00ff88); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            .pnl-positive { color: #00ff88; }
            .pnl-negative { color: #ff4466; }
            .clob-on { color: #00ff88; }
            .clob-off { color: #ffaa00; }
            input, select { background: #1e1e24; border: 1px solid #2a2a30; color: #e0e0e0; padding: 10px 12px; border-radius: 8px; width: 100%; margin-top: 4px; }
            button { background: #00ff88; color: #000; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; }
            .btn-secondary { background: #2a2a30; color: #e0e0e0; }
            .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
            .market-result { padding: 12px; border-bottom: 1px solid #2a2a30; cursor: pointer; }
            .market-result:hover { background: #1e1e24; }
            .search-results { max-height: 300px; overflow-y: auto; margin-top: 8px; border-radius: 8px; }
            .selected-market { background: #1a3a2a; padding: 12px; border-radius: 8px; margin-top: 12px; }
            canvas { max-height: 300px; width: 100%; }
            @media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } .balance-main { font-size: 28px; } }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
                    <h1 style="font-size: 24px;">🤖 HyperMeteo V4</h1>
                    <div><span id="clobStatus" class="clob-off">● CLOB: Инициализиране...</span></div>
                </div>
            </div>
            
            <div class="grid-2">
                <div class="card">
                    <div class="card-header">💰 ПОРТФЕЙЛ</div>
                    <div class="balance-main" id="balance">0.00 USDC</div>
                    <div><span id="pnl">+0.00</span> <span style="color:#888;">(П/З)</span></div>
                    <div style="margin-top: 12px;"><span>📉 Дневна загуба: </span><span id="dailyLoss">0.00</span><span> / ${settings.dailyLossLimit} USDC</span></div>
                </div>
                <div class="card">
                    <div class="card-header">🎯 ИЗБРАН ПАЗАР</div>
                    <div id="selectedMarketDisplay" style="color: #00ff88; font-weight: 500;">${settings.marketName || 'Няма избран пазар'}</div>
                    <div id="tokenIdDisplay" style="font-size: 11px; color: #888; margin-top: 8px;">${settings.marketTokenId ? 'Token ID: ' + settings.marketTokenId.substring(0, 20) + '...' : ''}</div>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">🔍 ТЪРСЕНЕ НА ПАЗАР</div>
                <input type="text" id="searchInput" placeholder="Напишете ключова дума... (напр. bitcoin, trump, iran)">
                <div id="searchResults" class="search-results"></div>
                <div id="selectedMarketInfo" class="selected-market" style="display: ${settings.marketName ? 'block' : 'none'}">
                    <div>✅ Избран пазар: <strong id="selectedMarketName">${settings.marketName}</strong></div>
                    <div style="margin-top: 8px;">
                        <label>Изход (Outcome):</label>
                        <select id="tokenOutcomeSelect">
                            <option value="Yes" ${settings.tokenOutcome === 'Yes' ? 'selected' : ''}>Yes</option>
                            <option value="No" ${settings.tokenOutcome === 'No' ? 'selected' : ''}>No</option>
                        </select>
                        <button id="saveMarketBtn" class="btn-secondary" style="margin-left: 10px;">💾 ЗАПАЗИ ТОЗИ ПАЗАР</button>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">📈 ГРАФИКА НА БАЛАНСА</div>
                <canvas id="balanceChart"></canvas>
            </div>
            
            <div class="grid-2">
                <div class="card">
                    <div class="card-header">⚙️ НАСТРОЙКИ ЗА ТЪРГОВИЯ</div>
                    <div><label>💰 Размер на сделката (USDC)</label><input type="number" id="tradeAmount" step="0.25" min="0.25" max="5.00" value="${settings.tradeAmount}"></div>
                    <div style="margin-top: 12px;"><label>⏱️ Cooldown (секунди)</label><input type="number" id="cooldownSeconds" step="5" min="30" max="300" value="${settings.cooldownSeconds}"></div>
                    <div style="margin-top: 12px;"><label>📈 Take-Profit (%)</label><input type="number" id="takeProfitPercent" step="1" min="2" max="50" value="${settings.takeProfitPercent}"></div>
                    <div style="margin-top: 12px;"><label>📉 Stop-Loss (%)</label><input type="number" id="stopLossPercent" step="1" min="2" max="50" value="${settings.stopLossPercent}"></div>
                    <div style="margin-top: 12px;"><label>📉 Дневен лимит за загуба (USDC)</label><input type="number" id="dailyLossLimit" step="0.5" min="0" max="10" value="${settings.dailyLossLimit}"></div>
                    <div style="margin-top: 12px;"><label>🎲 Kelly Criterion</label><select id="useKellyCriterion"><option value="true" ${settings.useKellyCriterion ? 'selected' : ''}>Включен</option><option value="false" ${!settings.useKellyCriterion ? 'selected' : ''}>Изключен</option></select></div>
                    <div style="margin-top: 12px;"><label>🔢 Kelly Fraction</label><input type="number" id="kellyFraction" step="0.05" min="0.05" max="0.50" value="${settings.kellyFraction}"></div>
                    <button id="saveSettingsBtn" style="margin-top: 20px; width: 100%;">💾 ЗАПАЗИ НАСТРОЙКИТЕ</button>
                </div>
                
                <div class="card">
                    <div class="card-header">📋 ПОСЛЕДНИ СДЕЛКИ</div>
                    <div id="tradesList">Няма сделки</div>
                    <button id="manualTradeBtn" class="btn-secondary" style="margin-top: 16px; width: 100%;">💸 РЪЧНА СДЕЛКА</button>
                </div>
            </div>
        </div>
        
        <script>
            let balanceChart = null;
            let currentMarkets = [];
            
            async function loadBalance() {
                const res = await fetch('/balance');
                const data = await res.json();
                document.getElementById('balance').innerHTML = (data.current || 0).toFixed(4) + ' USDC';
                const pnlSpan = document.getElementById('pnl');
                pnlSpan.innerHTML = (data.pnl >= 0 ? '+' : '') + data.pnl.toFixed(4);
                pnlSpan.className = data.pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
                await loadDailyStats();
                await loadBalanceHistory();
            }
            
            async function loadDailyStats() {
                const res = await fetch('/daily-stats');
                const stats = await res.json();
                document.getElementById('dailyLoss').innerHTML = stats.loss.toFixed(2);
            }
            
            async function loadBalanceHistory() {
                const res = await fetch('/balance-history');
                const history = await res.json();
                if (history.length > 0 && balanceChart) {
                    const labels = history.map(h => new Date(h.time).toLocaleTimeString());
                    const balances = history.map(h => h.balance);
                    balanceChart.data.labels = labels;
                    balanceChart.data.datasets[0].data = balances;
                    balanceChart.update();
                }
            }
            
            async function loadTrades() {
                const res = await fetch('/trades');
                const trades = await res.json();
                if (trades.length > 0) {
                    document.getElementById('tradesList').innerHTML = trades.slice(0, 10).map(t => 
                        '<div style="padding: 8px 0; border-bottom: 1px solid #2a2a30;">🕐 ' + new Date(t.time).toLocaleTimeString() + ' | $' + t.amount + ' | ' + (t.status || 'open') + '</div>'
                    ).join('');
                }
            }
            
            async function checkClobStatus() {
                const res = await fetch('/clob-status');
                const data = await res.json();
                const statusElem = document.getElementById('clobStatus');
                if (data.connected) {
                    statusElem.innerHTML = '🟢 CLOB: Свързан (реални ордери)';
                    statusElem.className = 'clob-on';
                } else {
                    statusElem.innerHTML = '🟡 CLOB: Симулация';
                    statusElem.className = 'clob-off';
                }
            }
            
            const searchInput = document.getElementById('searchInput');
            let searchTimeout;
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    const query = searchInput.value;
                    if (query.length < 2) return;
                    fetch('/api/search-markets?q=' + encodeURIComponent(query))
                        .then(r => r.json())
                        .then(markets => {
                            currentMarkets = markets;
                            const resultsDiv = document.getElementById('searchResults');
                            if (markets.length === 0) {
                                resultsDiv.innerHTML = '<div style="padding: 12px; color:#888;">Няма намерени пазари</div>';
                                return;
                            }
                            resultsDiv.innerHTML = markets.map(m => \`
                                <div class="market-result" data-id="\${m.id}" data-question="\${m.question.replace(/"/g, '&quot;')}" data-tokens='\${JSON.stringify(m.tokens)}'>
                                    <div style="font-weight: 500;">\${m.question}</div>
                                    <div style="font-size: 12px; color:#888;">Изходи: \${m.outcomes?.join(' / ') || 'Yes/No'}</div>
                                </div>
                            \`).join('');
                            
                            document.querySelectorAll('.market-result').forEach(el => {
                                el.addEventListener('click', () => {
                                    const question = el.dataset.question;
                                    const tokens = JSON.parse(el.dataset.tokens);
                                    const yesToken = tokens.find(t => t.outcome === 'Yes');
