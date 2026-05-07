import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ---------- РЕАЛНИ ПРОГНОЗИ ОТ OPEN-METEO (безплатно) ----------
async function getRealWeatherForecasts(lat, lon) {
  // Open-Meteo – безплатен, не изисква API ключ
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&forecast_days=1`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.hourly && data.hourly.temperature_2m.length > 0) {
      const tempAt12 = data.hourly.temperature_2m[12]; // 12:00 часа (индекс 12)
      
      // Open-Meteo дава само един модел, затова симулираме леки разлики за GFS, ECMWF, ICON
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
  
  // Ако API не работи, връщаме симулация (за да не спира бота)
  console.warn('⚠️ Използвам симулирани данни (Open-Meteo не отговори)');
  return {
    gfs: 15.2 + (Math.random() - 0.5) * 1.5,
    ecmwf: 15.1 + (Math.random() - 0.5) * 1.2,
    icon: 15.3 + (Math.random() - 0.5) * 1.3,
    actual: 15.2
  };
}

// Изчисляване на консенсус температура и confidence
function consensusTemperature(models) {
  const temps = [models.gfs, models.ecmwf, models.icon];
  const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
  const variance = temps.map(t => Math.pow(t - mean, 2)).reduce((a, b) => a + b, 0) / temps.length;
  const confidence = Math.max(0, Math.min(100, 100 - variance * 20)); // между 0 и 100
  
  return { consensus: mean, confidence };
}

// ---------- СЪСТОЯНИЕ НА БОТА (в паметта) ----------
let userState = {
  balance: 1000,           // USDT (симулиран)
  dailyPnL: 0,
  positions: [],
  maxDailyDrawdown: 5,     // процент
  perTradeBudget: 100,     // USDT на позиция
  botEnabled: true
};

// Симулирана търговия (за тест, без реални транзакции)
function placeTrade(direction, size, price, reason) {
  if (!userState.botEnabled) return { success: false, reason: 'Bot is disabled' };
  if (size > userState.perTradeBudget) return { success: false, reason: 'Budget exceeded' };
  if (userState.dailyPnL < -userState.maxDailyDrawdown) return { success: false, reason: 'Max drawdown reached' };

  const newPosition = {
    id: Date.now(),
    direction,   // 'up' (по-топло) или 'down' (по-студено)
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

// ---------- HTTP МАРШРУТИ ----------

// Основен маршрут (вече няма да пише "Cannot GET /")
app.get('/', (req, res) => {
  res.json({
    name: 'Polymarket Weather Trading Bot',
    version: '2.0',
    status: userState.botEnabled ? 'active' : 'paused',
    endpoints: [
      'GET  /status – състояние на бота',
      'POST /trade/decision – ботът взема решение (използва реални прогнози)',
      'POST /bot/toggle – включване/изключване на бота'
    ]
  });
});

app.get('/status', (req, res) => {
  res.json({
    botEnabled: userState.botEnabled,
    balance: userState.balance,
    dailyPnL: userState.dailyPnL,
    activePositions: userState.positions.length,
    maxDrawdown: userState.maxDailyDrawdown,
    perTradeBudget: userState.perTradeBudget,
    positions: userState.positions.slice(-5) // последните 5 позиции
  });
});

app.post('/trade/decision', async (req, res) => {
  if (!userState.botEnabled) {
    return res.status(403).json({ error: 'Bot is disabled', botEnabled: false });
  }

  // Координати (по подразбиране – София; можеш да смениш с друг град)
  const { lat = 42.70, lon = 23.32 } = req.body;
  
  const forecasts = await getRealWeatherForecasts(lat, lon);
  const { consensus, confidence } = consensusTemperature(forecasts);
  
  // Цената в Polymarket се определя от вероятността (0.1 – 0.9)
  const marketPrice = 0.5 + (consensus - 15) * 0.1;
  const clampedPrice = Math.min(0.9, Math.max(0.1, marketPrice));
  
  let decision = 'hold';
  let reason = '';
  let size = 0;
  
  // Стратегия: купуваме "нагоре", ако consensus > 15.5 и confidence > 70
  if (confidence > 70 && consensus > 15.5 && clampedPrice < 0.85) {
    decision = 'up';
    reason = `Консенсус ${consensus.toFixed(1)}°C > 15.5, увереност ${confidence.toFixed(0)}%`;
    size = userState.perTradeBudget;
  } 
  // Купуваме "надолу", ако consensus < 14.5 и confidence > 70
  else if (confidence > 70 && consensus < 14.5 && clampedPrice > 0.15) {
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

// Стартиране на сървъра
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌤️ Polymarket Weather Bot слуша на порт ${PORT}`);
  console.log(`📊 Статус: http://localhost:${PORT}/status`);
  console.log(`🤖 Ботът е ${userState.botEnabled ? 'ВКЛЮЧЕН' : 'ИЗКЛЮЧЕН'}`);
});
