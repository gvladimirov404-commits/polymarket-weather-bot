import express from 'express';
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ---------- СИМУЛАЦИЯ НА ВРЕМЕТО И ПОЛИМАРКЕТ ----------
// В реално приложение заменете с реални API извиквания
const getWeatherForecasts = () => {
  // Симулиране на трите модела: GFS, ECMWF, ICON
  const gfs = 15.2 + (Math.random() - 0.5) * 1.5;
  const ecmwf = 15.1 + (Math.random() - 0.5) * 1.2;
  const icon = 15.3 + (Math.random() - 0.5) * 1.3;
  return { gfs, ecmwf, icon };
};

const consensusTemperature = (models) => {
  const temps = [models.gfs, models.ecmwf, models.icon];
  const mean = temps.reduce((a,b) => a + b, 0) / temps.length;
  const variance = temps.map(t => Math.pow(t - mean, 2)).reduce((a,b) => a + b, 0) / temps.length;
  const confidence = Math.max(0, 100 - variance * 20); // по-ниска вариация = по-висока увереност
  return { consensus: mean, confidence };
};

// Състояние на потребителя (в паметта – за истинско приложение ползвай база данни)
let userState = {
  balance: 1000,       // USDT
  dailyPnL: 0,
  positions: [],       // отворени позиции
  maxDailyDrawdown: 5, // процент
  perTradeBudget: 100,
  botEnabled: true
};

const getDailyPnL = () => userState.dailyPnL;

const placeTrade = (direction, size, price, reason) => {
  if (!userState.botEnabled) return { success: false, reason: 'Bot disabled' };
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
  // В реална версия – изпращане на поръчка към Polymarket API
  console.log(`[TRADE] ${direction.toUpperCase()} ${size} USDT at ${price}: ${reason}`);
  return { success: true, position: newPosition };
};

// ----- HTTP МАРШРУТИ -----
app.get('/status', (req, res) => {
  res.json({
    botEnabled: userState.botEnabled,
    balance: userState.balance,
    dailyPnL: userState.dailyPnL,
    activePositions: userState.positions.length,
    maxDrawdown: userState.maxDailyDrawdown,
    perTradeBudget: userState.perTradeBudget
  });
});

app.post('/trade/decision', (req, res) => {
  if (!userState.botEnabled) return res.status(403).json({ error: 'Bot disabled' });

  const forecasts = getWeatherForecasts();
  const { consensus, confidence } = consensusTemperature(forecasts);
  const currentPrice = consensus; // в Polymarket цената отразява вероятността

  // Стратегия: ако confidence > 70 и цената не е крайна (между 0.1 и 0.9) – взимаме позиция
  let decision = 'hold';
  let reason = '';
  let size = 0;
  if (confidence > 70 && currentPrice > 0.1 && currentPrice < 0.9) {
    // Ако консенсусът е над някакъв праг (напр. 15.5°C) – вървим нагоре
    if (consensus > 15.5) {
      decision = 'buy_up';
      reason = `Consensus ${consensus.toFixed(1)}°C > 15.5, confidence ${confidence.toFixed(0)}%`;
      size = userState.perTradeBudget;
    } else if (consensus < 14.5) {
      decision = 'buy_down';
      reason = `Consensus ${consensus.toFixed(1)}°C < 14.5, confidence ${confidence.toFixed(0)}%`;
      size = userState.perTradeBudget;
    }
  }

  if (decision !== 'hold') {
    const tradeResult = placeTrade(decision, size, currentPrice, reason);
    if (tradeResult.success) {
      res.json({ decision, trade: tradeResult.position, forecasts, consensus, confidence });
    } else {
      res.status(400).json({ error: tradeResult.reason });
    }
  } else {
    res.json({ decision: 'hold', reason: 'Confidence too low or price extreme', forecasts, consensus, confidence });
  }
});

app.post('/bot/toggle', (req, res) => {
  userState.botEnabled = !userState.botEnabled;
  res.json({ botEnabled: userState.botEnabled });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Weather trading bot listening on port ${PORT}`);
});
