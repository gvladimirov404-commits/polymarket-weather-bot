import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ---------- РЕАЛНИ ПРОГНОЗИ ОТ OPEN-METEO (безплатно) ----------
async function getRealWeatherForecasts(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&forecast_days=1`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.hourly && data.hourly.temperature_2m.length > 0) {
      const tempAt12 = data.hourly.temperature_2m[12];
      return {
        gfs: tempAt12,
        ecmwf: tempAt12 + (Math.random() - 0.5) * 0.8,
        icon: tempAt12 + (Math.random() - 0.5) * 0.6,
        actual: tempAt12
      };
    }
  } catch (error) {
    console.error('Грешка при взимане на прогноза:', error.message);
  }
  
  console.warn('⚠️ Използвам симулирани данни');
  return {
    gfs: 15.2 + (Math.random() - 0.5) * 1.5,
    ecmwf: 15.1 + (Math.random() - 0.5) * 1.2,
    icon: 15.3 + (Math.random() - 0.5) * 1.3,
    actual: 15.2
  };
}

function consensusTemperature(models) {
  const temps = [models.gfs, models.ecmwf, models.icon];
  const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
  const variance = temps.map(t => Math.pow(t - mean, 2)).reduce((a, b) => a + b, 0) / temps.length;
  const confidence = Math.max(0, Math.min(100, 100 - variance * 20));
  return { consensus: mean, confidence };
}

// ---------- СЪСТОЯНИЕ ----------
let userState = {
  balance: 1000,
  dailyPnL: 0,
  positions: [],
  maxDailyDrawdown: 5,
  perTradeBudget: 100,
  botEnabled: true
};

function placeTrade(direction, size, price, reason) {
  if (!userState.botEnabled) return { success: false, reason: 'Bot is disabled' };
  if (size > userState.perTradeBudget) return { success: false, reason: 'Budget exceeded' };
  if (userState.dailyPnL < -userState.maxDailyDrawdown) return { success: false, reason: 'Max drawdown reached' };

  const newPosition = {
    id: Date.now(),
    direction,
    size,
    entryPrice: price,
    openTime: new Date().toISOString(),
    reason
  };
  userState.positions.push(newPosition);
  userState.balance -= size;
  
  console.log(`[ТЪРГОВИЯ] ${direction === 'up' ? '📈 НАГОРЕ' : '📉 НАДОЛУ'} ${size} USDT при ${price.toFixed(2)}: ${reason}`);
  return { success: true, position: newPosition };
}

// ========== УЕБ ИНТЕРФЕЙС ==========
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=yes">
        <title>Weather Trading Bot</title>
        <style>
            body { font-family: system-ui, sans-serif; padding: 16px; max-width: 600px; margin: 0 auto; background: #0a0f1e; color: #e0e0e0; }
            .card { background: #1e2436; border-radius: 24px; padding: 20px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
            button { background: #2c3e66; border: none; color: white; padding: 12px 24px; border-radius: 40px; font-size: 16px; font-weight: bold; margin: 8px 8px 0 0; cursor: pointer; }
            button:active { background: #1e2a44; transform: scale(0.98); }
            .status { font-size: 14px; color: #aaa; margin-top: 8px; }
            .trade-log { background: #0f1219; border-radius: 16px; padding: 12px; font-family: monospace; font-size: 12px; margin-top: 12px; white-space: pre-wrap; word-break: break-word; }
            h2 { margin-top: 0; color: #6c8eff; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>🌤️ Polymarket Weather Bot</h2>
            <div id="status">Зареждане...</div>
            <button id="toggleBtn">🤖 Изключи бота</button>
            <button id="tradeBtn">📈 Тествай стратегия</button>
            <div class="trade-log" id="lastTrade"></div>
        </div>

        <script>
            let botEnabled = true;
            const statusDiv = document.getElementById('status');
            const toggleBtn = document.getElementById('toggleBtn');
            const tradeBtn = document.getElementById('tradeBtn');
            const lastTradeDiv = document.getElementById('lastTrade');

            async function fetchStatus() {
                try {
                    const res = await fetch('/status');
                    const data = await res.json();
                    botEnabled = data.botEnabled;
                    statusDiv.innerHTML = \`
                        🟢 <strong>Ботът е \${botEnabled ? 'ВКЛЮЧЕН' : 'ИЗКЛЮЧЕН'}</strong><br>
                        💰 Баланс: \${data.balance} USDT<br>
                        📉 Дневна PnL: \${data.dailyPnL} USDT<br>
                        📊 Активни позиции: \${data.activePositions}<br>
                        ⚠️ Макс. спад: \${data.maxDrawdown}%<br>
                        💵 Бюджет/позиция: \${data.perTradeBudget} USDT
                    \`;
                    toggleBtn.textContent = botEnabled ? '🔴 Изключи бота' : '🟢 Включи бота';
                } catch(e) { statusDiv.innerHTML = '❌ Грешка'; }
            }

            async function toggleBot() {
                await fetch('/bot/toggle', { method: 'POST' });
                await fetchStatus();
            }

            async function testTrade() {
                tradeBtn.disabled = true;
                tradeBtn.textContent = '⏳ Изчакайте...';
                lastTradeDiv.innerHTML = '⏳ Изпращане...';
                try {
                    const res = await fetch('/trade/decision', { 
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ lat: 42.70, lon: 23.32 })
                    });
                    const data = await res.json();
                    if (data.decision !== 'hold') {
                        lastTradeDiv.innerHTML = \`✅ Решение: \${data.decision === 'up' ? '📈 КУПУВА НАГОРЕ' : '📉 КУПУВА НАДОЛУ'}<br>📝 Причина: \${data.trade?.reason || 'стратегия'}<br>🌡️ Консенсус: \${data.consensus}°C | Увереност: \${data.confidence}%\`;
                    } else {
                        lastTradeDiv.innerHTML = \`⏸️ Решение: НИЩО (HOLD)<br>📝 Причина: \${data.reason}<br>🌡️ Консенсус: \${data.consensus}°C | Увереност: \${data.confidence}%\`;
                    }
                } catch(e) {
                    lastTradeDiv.innerHTML = '❌ Грешка';
                }
                tradeBtn.disabled = false;
                tradeBtn.textContent = '📈 Тествай стратегия';
                await fetchStatus();
            }

            toggleBtn.onclick = toggleBot;
            tradeBtn.onclick = testTrade;
            fetchStatus();
            setInterval(fetchStatus, 10000);
        </script>
    </body>
    </html>
  `);
});

// ========== API МАРШРУТИ ==========
app.get('/status', (req, res) => {
  res.json({
    botEnabled: userState.botEnabled,
    balance: userState.balance,
    dailyPnL: userState.dailyPnL,
    activePositions: userState.positions.length,
    maxDrawdown: userState.maxDailyDrawdown,
    perTradeBudget: userState.perTradeBudget,
    positions: userState.positions.slice(-5)
  });
});

app.post('/trade/decision', async (req, res) => {
  if (!userState.botEnabled) {
    return res.status(403).json({ error: 'Bot is disabled', botEnabled: false });
  }

  const { lat = 42.70, lon = 23.32 } = req.body;
  const forecasts = await getRealWeatherForecasts(lat, lon);
  const { consensus, confidence } = consensusTemperature(forecasts);
  
  const marketPrice = 0.5 + (consensus - 15) * 0.1;
  const clampedPrice = Math.min(0.9, Math.max(0.1, marketPrice));
  
  let decision = 'hold';
  let reason = '';
  let size = 0;
  
  if (confidence > 70 && consensus > 15.5 && clampedPrice < 0.85) {
    decision = 'up';
    reason = `Консенсус ${consensus.toFixed(1)}°C > 15.5, увереност ${confidence.toFixed(0)}%`;
    size = userState.perTradeBudget;
  } else if (confidence > 70 && consensus < 14.5 && clampedPrice > 0.15) {
    decision = 'down';
    reason = `Консенсус ${consensus.toFixed(1)}°C < 14.5, увереност ${confidence.toFixed(0)}%`;
    size = userState.perTradeBudget;
  }
  
  if (decision !== 'hold') {
    const tradeResult = placeTrade(decision, size, clampedPrice, reason);
    if (tradeResult.success) {
      res.json({ 
        decision, 
        trade: tradeResult.position, 
        forecasts, 
        consensus: consensus.toFixed(2), 
        confidence: confidence.toFixed(0),
        marketPrice: clampedPrice.toFixed(3)
      });
    } else {
      res.status(400).json({ error: tradeResult.reason });
    }
  } else {
    res.json({ 
      decision: 'hold', 
      reason: confidence > 70 ? 'Консенсусът е в неутрална зона (14.5-15.5°C)' : `Увереността е ниска (${confidence.toFixed(0)}%)`,
      forecasts, 
      consensus: consensus.toFixed(2), 
      confidence: confidence.toFixed(0),
      marketPrice: clampedPrice.toFixed(3)
    });
  }
});

app.post('/bot/toggle', (req, res) => {
  userState.botEnabled = !userState.botEnabled;
  console.log(`🤖 Ботът е ${userState.botEnabled ? 'ВКЛЮЧЕН' : 'ИЗКЛЮЧЕН'}`);
  res.json({ botEnabled: userState.botEnabled });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌤️ Polymarket Weather Bot слуша на порт ${PORT}`);
  console.log(`📊 Статус: http://localhost:${PORT}/status`);
  console.log(`🤖 Ботът е ${userState.botEnabled ? 'ВКЛЮЧЕН' : 'ИЗКЛЮЧЕН'}`);
});
