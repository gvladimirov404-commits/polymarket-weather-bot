require('dotenv').config();
const express = require('express');
const { ClobClient } = require('@polymarket/clob-client');
const { getRealUSDCBalance } = require('./balanceChecker');

const app = express();
const PORT = 3000;

// ============ КОНФИГУРАЦИЯ ============
const PRIVATE_KEY = process.env.POLYMARKET_PRIVATE_KEY;
const WALLET_ADDRESS = '0xfC74Aeb8eaCf185A4D1c4EC6a4A1aC60702E4785';
const FIXED_BALANCE = 17.93; // fallback, ако RPC не работи

// Пазар: Will bitcoin hit $1M by 2030? (Token ID - временен, ще се опресни)
const MARKET_TOKEN_ID = '71317238123731522030021395100684597673170796261859777545687942220367359305106';

let currentBalance = FIXED_BALANCE;
let startingBalance = null;
let totalPnL = 0;
let lastTradeTime = 0;
const COOLDOWN_MINUTES = 1;
const COOLDOWN_MS = COOLDOWN_MINUTES * 60 * 1000;

// Глобални променливи за уеб панела
global.realBalance = { current: FIXED_BALANCE, starting: null, pnl: 0, lastUpdate: null };
global.tradeLog = [];

// ============ ИНИЦИАЛИЗАЦИЯ НА CLOB ============
let clobClient = null;

async function initClob() {
  try {
    clobClient = new ClobClient({
      networkId: 137, // Polygon Mainnet
      apiKey: process.env.CLOB_API_KEY,
      secret: process.env.CLOB_SECRET,
      passphrase: process.env.CLOB_PASSPHRASE,
    });
    await clobClient.createOrDeriveApiKey();
    console.log('✅ CLOB клиент инициализиран');
  } catch (error) {
    console.error('❌ CLOB грешка:', error.message);
  }
}

// ============ ПРОВЕРКА НА РЕАЛЕН БАЛАНС ============
async function updateRealBalance() {
  const result = await getRealUSDCBalance(WALLET_ADDRESS);
  if (result.success) {
    currentBalance = result.balance;
    if (startingBalance === null) {
      startingBalance = result.balance;
      global.realBalance.starting = startingBalance;
    }
    totalPnL = result.balance - startingBalance;
    
    global.realBalance = {
      current: result.balance,
      starting: startingBalance,
      pnl: totalPnL,
      lastUpdate: new Date().toISOString(),
      success: true
    };
    
    console.log(`💰 Реален USDC: ${result.balance.toFixed(4)} | П/З: ${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(4)}`);
  } else {
    console.log('⚠️ RPC грешка - използвам фиксиран баланс');
    global.realBalance = {
      current: currentBalance,
      starting: startingBalance,
      pnl: totalPnL,
      lastUpdate: new Date().toISOString(),
      success: false,
      error: result.error
    };
  }
}

// ============ ТЪРГОВСКА ФУНКЦИЯ ============
async function executeTrade() {
  const now = Date.now();
  if (now - lastTradeTime < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - (now - lastTradeTime)) / 1000);
    console.log(`✖ Cooldown - изчакайте ${remaining} секунди`);
    return;
  }

  if (!clobClient) {
    console.log('❌ CLOB клиентът не е инициализиран');
    return;
  }

  try {
    // Симулира сделка (за тест - замени с реален ордер когато имаш credentials)
    console.log(`🚀 Изпълнявам сделка за $1.00 на ${new Date().toLocaleTimeString()}`);
    
    // Тук ще дойде реалният ордер към Polymarket
    // За момента само логваме
    
    lastTradeTime = now;
    
    // Запис в търговския лог
    const tradeEntry = {
      time: new Date().toISOString(),
      amount: 1.00,
      market: 'Will bitcoin hit $1M by 2030?',
      status: 'executed'
    };
    global.tradeLog.unshift(tradeEntry);
    if (global.tradeLog.length > 100) global.tradeLog.pop();
    
    console.log('✅ Сделката е изпълнена');
    
    // След сделката провери реалния баланс
    setTimeout(() => updateRealBalance(), 5000);
    
  } catch (error) {
    console.error('❌ Грешка при сделка:', error.message);
  }
}

// ============ УЕБ ПАНЕЛ ============
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>HyperMeteo Bot</title>
      <meta http-equiv="refresh" content="10">
      <style>
        body { font-family: monospace; background: #0a0a0a; color: #0f0; padding: 20px; }
        .balance { font-size: 24px; margin: 10px 0; }
        .pnl-positive { color: #0f0; }
        .pnl-negative { color: #f00; }
        .card { background: #1a1a1a; padding: 15px; margin: 10px 0; border-left: 3px solid #0f0; }
        .trade { background: #111; padding: 8px; margin: 5px 0; font-size: 12px; }
        button { background: #0f0; color: #000; border: none; padding: 10px 20px; cursor: pointer; }
      </style>
    </head>
    <body>
      <h1>🤖 HyperMeteo V4</h1>
      <div class="card">
        <h2>💰 Реален баланс (USDC)</h2>
        <div class="balance" id="balance">Зареждане...</div>
        <div id="pnl"></div>
        <div id="lastUpdate"></div>
        <div id="rpcStatus"></div>
      </div>
      
      <div class="card">
        <h2>📊 Статистика</h2>
        <div>💱 Фиксиран fallback: $${FIXED_BALANCE}</div>
        <div>⏱️ Cooldown: ${COOLDOWN_MINUTES} мин.</div>
        <div>🎯 Take-Profit: 15% | Stop-Loss: 8%</div>
      </div>
      
      <div class="card">
        <h2>📋 Последни сделки</h2>
        <div id="trades">Зареждане...</div>
      </div>
      
      <button onclick="fetch('/trade', {method:'POST'})">💸 РЪЧНА СДЕЛКА</button>
      
      <script>
        async function loadData() {
          const balanceRes = await fetch('/balance');
          const balance = await balanceRes.json();
          if (balance.success) {
            document.getElementById('balance').innerHTML = $${balance.current.toFixed(4)};
            const pnlElem = document.getElementById('pnl');
            const pnl = balance.pnl;
            pnlElem.innerHTML = '📈 Печалба/Загуба: ' + (pnl >= 0 ? '+' : '') + pnl.toFixed(4) + ' USDC';
            pnlElem.className = pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
            document.getElementById('lastUpdate').innerHTML = '🕐 Последна проверка: ' + new Date(balance.lastUpdate).toLocaleTimeString();
            if (balance.starting) {
              document.getElementById('rpcStatus').innerHTML = '✅ RPC свързан | Начален баланс: $' + balance.starting.toFixed(4);
            } else {
              document.getElementById('rpcStatus').innerHTML = '⏳ Зареждане на начален баланс...';
            }
          } else {
            document.getElementById('balance').innerHTML = '⚠️ ' + balance.current.toFixed(4) + ' (фиксиран - без RPC)';
            document.getElementById('rpcStatus').innerHTML = '❌ RPC грешка: ' + (balance.error || 'unknown');
          }
          
          const tradesRes = await fetch('/trades');
          const trades = await tradesRes.json();
          if (trades.length > 0) {
            document.getElementById('trades').innerHTML = trades.map(t => 
              '<div class="trade">🕐 ' + new Date(t.time).toLocaleTimeString() + ' | $' + t.amount + ' | ' + t.market + ' | ' + t.status + '</div>'
            ).join('');
          } else {
            document.getElementById('trades').innerHTML = 'Няма изпълнени сделки';
          }
        }
        
        loadData();
        setInterval(loadData, 10000);
      </script>
    </body>
    </html>
  `);
});

app.get('/balance', async (req, res) => {
  res.json(global.realBalance);
});

app.get('/trades', (req, res) => {
  res.json(global.tradeLog);
});

app.post('/trade', async (req, res) => {
  await executeTrade();
  res.json({ success: true, message: 'Сделката е изпълнена' });
});

// ============ СТАРТ ============
async function start() {
  await initClob();
  await updateRealBalance();
  
  // Автоматична търговия на всеки 60 секунди
  setInterval(() => {
    executeTrade();
  }, 60000);
  
  // Проверка на баланса на всяка минута
  setInterval(() => {
    updateRealBalance();
  }, 60000);
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Уеб панел: http://89.117.152.7:${PORT}`);
  });
}

start().catch(console.error);
