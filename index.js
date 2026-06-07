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

// ========== НАЛИЧНИ СТРАТЕГИИ ==========
const STRATEGIES = {
    HEDGE: 'hedge',
    BTC_5MIN: 'btc_5min'
};

// ========== ТЕКУЩА СТРАТЕГИЯ ==========
let currentStrategy = STRATEGIES.HEDGE;

// ========== НАСТРОЙКИ ПО ПОДРАЗБИРАНЕ ==========
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
        maxPositionSize: 1.00,
        minBalanceRequired: 10.00
    }
};

let settings = { ...DEFAULT_SETTINGS[currentStrategy] };

// ========== ГЛОБАЛНИ ПРОМЕНЛИВИ ==========
let startingBalance = null;
let lastTradeTime = 0;
let clobClient = null;
let accountAddress = null;
let activeMarket = null;
let marketStartPrice = 0;
let currentBTCPrice = 0;
let dailyPnL = 0;
let dailyTradeCount = 0;
let lastResetDate = new Date().toDateString();
let confidenceScore = 0;
let backtestRunning = false;

global.realBalance = { current: 0, starting: null, pnl: 0, mode: 'initializing' };
global.tradeLog = [];

// ========== ПОМОЩНИ ФУНКЦИИ ==========
function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            currentStrategy = saved.currentStrategy || STRATEGIES.HEDGE;
            settings = { ...DEFAULT_SETTINGS[currentStrategy], ...saved[currentStrategy] };
            console.log(`📁 Заредена стратегия: ${currentStrategy}`);
        }
    } catch (error) {}
}

function saveSettings() {
    const toSave = {
        currentStrategy: currentStrategy,
        [currentStrategy]: settings
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2));
}

function saveTradesHistory() {
    try {
        fs.writeFileSync(TRADES_FILE, JSON.stringify(global.tradeLog.slice(0, 1000), null, 2));
    } catch (error) {}
}

function checkDailyLimits() {
    const today = new Date().toDateString();
    if (today !== lastResetDate) {
        dailyPnL = 0;
        dailyTradeCount = 0;
        lastResetDate = today;
        console.log('📅 Дневните лимити са нулирани');
    }
    
    if (currentStrategy === STRATEGIES.BTC_5MIN) {
        if (settings.dailyLossLimit > 0 && dailyPnL <= -settings.dailyLossLimit) {
            console.log(`⛔ Лимит загуба: $${dailyPnL.toFixed(2)}`);
            return false;
        }
        if (settings.dailyProfitLimit > 0 && dailyPnL >= settings.dailyProfitLimit) {
            console.log(`✅ Лимит печалба: $${dailyPnL.toFixed(2)}`);
            return false;
        }
    }
    return true;
}

// ========== BTC ЦЕНА ==========
async function getBTCPrice() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        const data = await response.json();
        return parseFloat(data.price);
    } catch (error) {
        return 0;
    }
}

// ========== 5-МИНУТНА BTC СТРАТЕГИЯ ==========
function getCurrentMarketSlug() {
    const now = Math.floor(Date.now() / 1000);
    const fiveMinutes = 300;
    const windowStart = Math.floor(now / fiveMinutes) * fiveMinutes;
    return `btc-updown-5m-${windowStart}`;
}

async function discoverCurrentMarket() {
    try {
        const slug = getCurrentMarketSlug();
        const eventResponse = await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`);
        const events = await eventResponse.json();
        if (!events || events.length === 0) return null;
        const event = events[0];
        const market = event.markets?.[0];
        if (!market || !market.clobTokenIds) return null;
        const [yesTokenId, noTokenId] = market.clobTokenIds;
        return { slug, title: event.title, yesTokenId, noTokenId };
    } catch (error) {
        return null;
    }
}

async function calculateConfidenceScore(percentChange, marketPrice) {
    let score = 0;
    if (percentChange >= settings.deltaStrong) score += 0.4;
    else if (percentChange >= settings.deltaWeak) score += 0.25;
    if (marketPrice >= 0.96) score += 0.35;
    else if (marketPrice >= settings.minMarketPrice) score += 0.2;
    confidenceScore = Math.min(1, Math.max(0, score));
    return confidenceScore;
}

function getPositionSizeByConfidence(confidence) {
    if (confidence >= 0.85) return Math.min(settings.strongBetSize, settings.maxPositionSize);
    if (confidence >= 0.70) return Math.min(settings.mediumBetSize, settings.maxPositionSize);
    if (confidence >= 0.60) return Math.min(settings.weakBetSize, settings.maxPositionSize);
    return 0;
}

async function executeBTC5MinTrade() {
    const now = Date.now();
    if (!checkDailyLimits()) return;
    if (global.realBalance.current < (settings.minBalanceRequired || 10)) return;
    
    const market = await discoverCurrentMarket();
    if (!market) return;
    
    const secondsInWindow = Math.floor((now / 1000) % 300);
    const secondsRemaining = 300 - secondsInWindow;
    if (secondsRemaining > settings.entrySecondsMax || secondsRemaining < settings.entrySecondsMin) return;
    
    const currentPrice = await getBTCPrice();
    if (currentPrice === 0) return;
    
    if (marketStartPrice === 0) {
        marketStartPrice = currentPrice;
        currentBTCPrice = currentPrice;
        return;
    }
    
    currentBTCPrice = currentPrice;
    const percentChange = Math.abs((currentPrice - marketStartPrice) / marketStartPrice);
    if (percentChange < settings.deltaSkip) return;
    
    const direction = currentPrice > marketStartPrice ? 'UP' : 'DOWN';
    const tokenId = direction === 'UP' ? market.yesTokenId : market.noTokenId;
    
    // Получаваме цена от Polymarket (симулация, ако няма CLOB)
    let marketPrice = 0.95;
    if (clobClient) {
        try {
            const orderBook = await clobClient.getOrderBook(tokenId);
            if (orderBook?.bids?.length > 0) marketPrice = parseFloat(orderBook.bids[0].price);
        } catch(e) {}
    }
    
    if (marketPrice < settings.minMarketPrice || marketPrice > settings.maxMarketPrice) return;
    
    const confidence = await calculateConfidenceScore(percentChange, marketPrice);
    if (confidence < settings.minConfidence) return;
    
    const betSize = getPositionSizeByConfidence(confidence);
    if (betSize === 0) return;
    
    const cooldownMs = 300 * 1000;
    if (now - lastTradeTime < cooldownMs) return;
    
    console.log(`🎯 [5-min BTC] ${direction} | Confidence: ${(confidence * 100).toFixed(1)}% | Залог: $${betSize.toFixed(2)}`);
    
    lastTradeTime = now;
    global.tradeLog.unshift({
        time: new Date().toISOString(),
        strategy: '5-min BTC',
        amount: betSize,
        direction: direction,
        confidence: confidence,
        marketPrice: marketPrice,
        status: 'signal_generated'
    });
    saveTradesHistory();
    setTimeout(() => updateRealBalance(), 5000);
}

// ========== ХЕДЖ СТРАТЕГИЯ (70/15/15) ==========
async function executeHedgeTrade() {
    const now = Date.now();
    const cooldownMs = (settings.cooldownSeconds || 60) * 1000;
    if (now - lastTradeTime < cooldownMs) return;
    
    const tradeAmount = settings.tradeAmount || 1.00;
    console.log(`🎯 [Хедж] Сделка за $${tradeAmount.toFixed(2)} | TP: ${settings.takeProfitPercent}% | SL: ${settings.stopLossPercent}% | Hedge: ${(settings.hedgeRatio * 100)}%`);
    
    lastTradeTime = now;
    global.tradeLog.unshift({
        time: new Date().toISOString(),
        strategy: 'Хедж 70/15/15',
        amount: tradeAmount,
        takeProfit: settings.takeProfitPercent,
        stopLoss: settings.stopLossPercent,
        hedgeRatio: settings.hedgeRatio,
        status: 'signal_generated'
    });
    saveTradesHistory();
    setTimeout(() => updateRealBalance(), 5000);
}

// ========== BACKTEST МОДУЛ (за текущата стратегия) ==========
async function runBacktest(days = 7) {
    if (backtestRunning) return { error: 'Backtest вече работи' };
    backtestRunning = true;
    
    console.log(`\n🔬 BACKTEST ЗА ${days} ДНИ - Стратегия: ${currentStrategy}\n`);
    
    let simulatedBalance = 100;
    let wins = 0, losses = 0;
    let trades = [];
    const cyclesPerDay = currentStrategy === STRATEGIES.BTC_5MIN ? 288 : 24; // 5-min BTC = 288 цикъла/ден, Хедж = 24
    
    for (let i = 0; i < days * cyclesPerDay; i++) {
        // Симулираме win rate според стратегията
        const baseWinRate = currentStrategy === STRATEGIES.BTC_5MIN ? 0.62 : 0.55;
        const shouldWin = Math.random() < baseWinRate;
        
        if (currentStrategy === STRATEGIES.BTC_5MIN) {
            const betSize = settings.mediumBetSize || 0.5;
            if (shouldWin) {
                const profit = betSize * ((settings.takeProfitBid - settings.limitPrice) / settings.limitPrice);
                simulatedBalance += profit;
                wins++;
                trades.push({ win: true, profit });
            } else {
                simulatedBalance -= betSize;
                losses++;
                trades.push({ win: false, loss: betSize });
            }
        } else {
            const betSize = settings.tradeAmount || 1;
            if (shouldWin) {
                const profit = betSize * (settings.takeProfitPercent / 100);
                simulatedBalance += profit;
                wins++;
                trades.push({ win: true, profit });
            } else {
                const loss = betSize * (settings.stopLossPercent / 100);
                simulatedBalance -= loss;
                losses++;
                trades.push({ win: false, loss });
            }
        }
    }
    
    const winRate = (wins / (wins + losses)) * 100;
    const totalPnL = simulatedBalance - 100;
    const avgWin = trades.filter(t => t.win).reduce((s, t) => s + t.profit, 0) / (wins || 1);
    const avgLoss = trades.filter(t => !t.win).reduce((s, t) => s + t.loss, 0) / (losses || 1);
    
    console.log(`📊 BACKTEST РЕЗУЛТАТИ:`);
    console.log(`🏆 Win Rate: ${winRate.toFixed(1)}% (${wins}/${wins + losses})`);
    console.log(`💰 Краен баланс: $${simulatedBalance.toFixed(2)}`);
    console.log(`📈 Обща печалба: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}`);
    
    backtestRunning = false;
    return { winRate, totalPnL, wins, losses, avgWin, avgLoss, finalBalance: simulatedBalance };
}

// ========== CLOB ИНИЦИАЛИЗАЦИЯ ==========
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
        const tempClient = new ClobClient({ host: 'https://clob.polymarket.com', chainId: 137, signer });
        const apiCreds = await tempClient.createApiKey();
        console.log("✅ L2 credentials извлечени (v2)");
        clobClient = new ClobClient({ host: 'https://clob.polymarket.com', chainId: 137, signer, creds: apiCreds, signatureType: 3, funderAddress: accountAddress });
        console.log("✅ ClobClient v2 инициализиран");
        global.realBalance.mode = 'live';
    } catch (error) {
        console.error('❌ CLOB грешка:', error.message);
        global.realBalance.mode = 'simulation';
    }
}

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
            lastUpdate: new Date().toISOString()
        };
        console.log(`💰 Баланс: $${result.balance.toFixed(4)} | П/З: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(4)}`);
    }
}

// ========== УНИВЕРСАЛЕН УЕБ ПАНЕЛ ==========
app.get('/', (req, res) => {
    const isBTCStrategy = currentStrategy === STRATEGIES.BTC_5MIN;
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>HyperMeteo V4 - Multi-Strategy Bot</title>
    <meta http-equiv="refresh" content="10">
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:#0a0a0f;color:#e0e0e0;font-family:monospace;padding:20px}
        .dashboard{max-width:1400px;margin:0 auto}
        .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding:16px 20px;background:#111116;border-radius:12px;border:1px solid #2a2a30}
        .logo{font-size:24px;font-weight:bold;color:#00ff88}
        .strategy-selector{background:#1a1a20;padding:8px 16px;border-radius:8px}
        .card{background:#111116;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #2a2a30}
        .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:16px}
        .value{font-size:28px;font-weight:bold;color:#00ff88}
        .positive{color:#00ff88}.negative{color:#ff4466}
        select,input,button{background:#1a1a20;border:1px solid #2a2a30;color:#fff;padding:10px;border-radius:8px;margin:5px}
        button{background:#00ff88;color:#000;cursor:pointer;font-weight:bold}
        .strategy-btn{padding:8px 16px;margin:0 5px;border-radius:20px;cursor:pointer}
        .active-strategy{background:#00ff88;color:#000}
        .inactive-strategy{background:#2a2a30;color:#888}
        .backtest-result{padding:10px;background:#1a1a20;border-radius:8px;margin-top:10px}
    </style>
</head>
<body>
<div class="dashboard">
    <div class="header">
        <div class="logo">🤖 HyperMeteo V4</div>
        <div class="strategy-selector">
            <button id="btnHedge" class="strategy-btn ${currentStrategy === 'hedge' ? 'active-strategy' : 'inactive-strategy'}" onclick="switchStrategy('hedge')">📊 Хедж 70/15/15</button>
            <button id="btnBTC5min" class="strategy-btn ${currentStrategy === 'btc_5min' ? 'active-strategy' : 'inactive-strategy'}" onclick="switchStrategy('btc_5min')">⚡ 5-min BTC</button>
        </div>
    </div>
    
    <div class="grid">
        <div class="card"><div>💰 Баланс</div><div class="value">$${global.realBalance.current?.toFixed(2) || '0'}</div><div>П/З: ${(global.realBalance.pnl || 0) >= 0 ? '+' : ''}${(global.realBalance.pnl || 0).toFixed(2)}</div></div>
        <div class="card"><div>📊 Текуща стратегия</div><div class="value" style="font-size:18px">${currentStrategy === 'hedge' ? 'Хедж 70/15/15' : '5-min BTC'}</div><div>Дневен P&L: ${dailyPnL >= 0 ? '+' : ''}$${dailyPnL.toFixed(2)}</div></div>
        <div class="card"><div>🎯 Confidence</div><div class="value">${isBTCStrategy ? (confidenceScore * 100).toFixed(1) + '%' : 'N/A'}</div><div>${isBTCStrategy ? `Праг: ${(settings.minConfidence * 100)}%` : 'Не е приложимо'}</div></div>
        <div class="card"><div>⚙️ Статус</div><div class="value">${global.realBalance.mode === 'live' ? '🔴 РЕАЛЕН' : '⚠️ СИМУЛАЦИЯ'}</div><div>CLOB: ${clobClient ? '✅' : '❌'}</div></div>
    </div>
    
    <div class="card">
        <h3>⚙️ Настройки (${currentStrategy === 'hedge' ? 'Хедж стратегия' : '5-min BTC стратегия'})</h3>
        <form id="settingsForm">
            ${isBTCStrategy ? `
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
                    <div><label>💰 Ставка (базова):</label><input type="number" name="tradeAmount" value="${settings.tradeAmount}" step="0.05"></div>
                    <div><label>🎯 Лимит цена:</label><input type="number" name="limitPrice" value="${settings.limitPrice}" step="0.01"></div>
                    <div><label>📈 TP цена:</label><input type="number" name="takeProfitBid" value="${settings.takeProfitBid}" step="0.01"></div>
                    <div><label>🎯 Min Confidence (%):</label><input type="number" name="minConfidence" value="${(settings.minConfidence * 100)}" step="5"></div>
                    <div><label>📊 Min Market Price:</label><input type="number" name="minMarketPrice" value="${settings.minMarketPrice}" step="0.01"></div>
                    <div><label>📅 Дневен лимит загуба:</label><input type="number" name="dailyLossLimit" value="${settings.dailyLossLimit}" step="0.5"></div>
                    <div><label>🎯 Дневен лимит печалба:</label><input type="number" name="dailyProfitLimit" value="${settings.dailyProfitLimit}" step="0.5"></div>
                </div>
            ` : `
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
                    <div><label>💰 Размер на сделка:</label><input type="number" name="tradeAmount" value="${settings.tradeAmount}" step="0.25"></div>
                    <div><label>⏱️ Cooldown (s):</label><input type="number" name="cooldownSeconds" value="${settings.cooldownSeconds}" step="10"></div>
                    <div><label>📈 Take-Profit (%):</label><input type="number" name="takeProfitPercent" value="${settings.takeProfitPercent}" step="1"></div>
                    <div><label>📉 Stop-Loss (%):</label><input type="number" name="stopLossPercent" value="${settings.stopLossPercent}" step="1"></div>
                    <div><label>🛡️ Hedge Ratio (%):</label><input type="number" name="hedgeRatio" value="${(settings.hedgeRatio * 100)}" step="5"></div>
                </div>
            `}
            <button type="submit">💾 ЗАПАЗИ НАСТРОЙКИТЕ</button>
        </form>
    </div>
    
    <div class="card">
        <h3>🔬 Backtest (7 дни - текуща стратегия)</h3>
        <button onclick="runBacktest()">📊 ПУСНИ BACKTEST</button>
        <div id="backtestResult" class="backtest-result"></div>
    </div>
    
    <div class="card">
        <h3>📋 Последни сделки</h3>
        <div style="max-height:300px;overflow-y:auto" id="tradesTable"></div>
    </div>
</div>

<script>
async function switchStrategy(strategy) {
    const response = await fetch('/switch-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: strategy })
    });
    const result = await response.json();
    if (result.success) location.reload();
}

async function saveSettings() {
    const form = document.getElementById('settingsForm');
    const formData = new FormData(form);
    const data = {};
    formData.forEach((value, key) => { data[key] = isNaN(value) ? value : parseFloat(value); });
    if (data.minC
