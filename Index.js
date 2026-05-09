import express from 'express';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ======================== НАСТРОЙКИ ========================
const INITIAL_BALANCE = 70.0;
const POSITION_PERCENT = 0.01;      // 1% от баланса на сделка
const DAILY_LOSS_LIMIT = 0.03;      // 3% дневен лимит за загуба
const MONTHLY_LOSS_LIMIT = 0.10;    // 10% месечен лимит
const CONFIDENCE_THRESHOLD = 70;    // Минимална увереност за отваряне
const TEMP_UP = 15.5;
const TEMP_DOWN = 14.5;

// Състояние на бота (симулация, тъй като Polymarket е блокиран)
let userState = {
  balance: INITIAL_BALANCE,
  dailyPnL: 0,
  monthlyPnL: 0,
  positions: [],
  botEnabled: true,
  lastResetDate: new Date().toDateString(),
  balance_history: [{ date: new Date().toISOString(), balance: INITIAL_BALANCE }]
};

// Помощна функция за добавяне в историята
function addBalanceHistory() {
  userState.balance_history.push({ date: new Date().toISOString(), balance: userState.balance });
}

// Нулиране на дневния PnL
function resetDailyIfNeeded() {
  const today = new Date().toDateString();
  if (today !== userState.lastResetDate) {
    userState.dailyPnL = 0;
    userState.lastResetDate = today;
    console.log("🔄 Дневният PnL е нулиран.");
  }
}

// ======================== МЕТЕОРОЛОГИЧЕН МОДУЛ ========================
async function getWeatherForecast(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&forecast_days=1`;
  try {
    const response = await axios.get(url);
    if (response.data.hourly && response.data.hourly.temperature_2m.length > 0) {
      const tempAt12 = response.data.hourly.temperature_2m[12];
      // Open-Meteo дава само един модел, симулираме леки разлики за консенсус
      return {
        ecmwf: tempAt12,
        gfs: tempAt12 + (Math.random() - 0.5) * 0.8,
        icon: tempAt12 + (Math.random() - 0.5) * 0.6
      };
    }
  } catch (err) {
    console.error(`Грешка при прогноза за (${lat},${lon}):`, err.message);
  }
  return null;
}

function calculateConsensus(forecasts) {
  if (!forecasts) return null;
  const temps = [forecasts.ecmwf, forecasts.gfs, forecasts.icon];
  const mean = temps.reduce((a, b) => a + b, 0) / 3;
  const variance = temps.map(t => Math.pow(t - mean, 2)).reduce((a, b) => a + b, 0) / 3;
  let confidence = Math.min(100, Math.max(0, 100 - variance * 20));
  return { consensus: mean, confidence };
}

// ======================== ТЪРГОВСКА ЛОГИКА (СИМУЛАЦИЯ) ========================
function openPosition(city, direction, price, reason, confidence) {
  let size = userState.balance * POSITION_PERCENT;
  size = Math.min(size, 2.0); // макс $2 за безопасност
  if (size < 0.2) size = 0.2;

  const position = {
    id: Date.now() + Math.random(),
    city: city,
    direction,
    size,
    entryPrice: price,
    openTime: new Date().toISOString(),
    reason,
    confidence,
    closed: false
  };
  userState.positions.push(position);
  userState.balance -= size;
  addBalanceHistory();
  console.log(`📈 Нова позиция в ${city}: ${direction.toUpperCase()} ${size.toFixed(2)} USDC при ${price.toFixed(2)} – ${reason}`);
}

function closePosition(position, outcome) {
  const pnlPercent = (outcome === 'win') ? 0.25 : -0.15;
  const pnl = position.size * pnlPercent;
  userState.balance += position.size + pnl;
  userState.dailyPnL += pnl;
  userState.monthlyPnL += pnl;
  addBalanceHistory();
  position.closed = true;
  position.closedAt = new Date().toISOString();
  position.pnl = pnl;
  console.log(`🔒 Затворена позиция в ${position.city}: ${outcome === 'win' ? 'ПЕЧАЛБА' : 'ЗАГУБА'} ${pnl.toFixed(2)} USDC`);
}

// Мониторинг на позициите (симулация – затваряне след 24 часа)
async function monitorPositions() {
  const now = new Date();
  for (let pos of userState.positions.filter(p => !p.closed)) {
    const ageHours = (now - new Date(pos.openTime)) / (1000 * 3600);
    if (ageHours >= 24) {
      const winChance = pos.confidence / 100;
      const outcome = Math.random() < winChance ? 'win' : 'loss';
      closePosition(pos, outcome);
    }
  }
}

// Сканиране на градове и вземане на решение
async function scanAndTrade() {
  if (!userState.botEnabled) return;
  resetDailyIfNeeded();

  // Дневен лимит за загуба
  if (userState.dailyPnL <= -INITIAL_BALANCE * DAILY_LOSS_LIMIT) {
    console.log("⛔ Дневният лимит за загуба е достигнат.");
    return;
  }

  // Списък с популярни градове за прогнозни пазари
  const cities = [
    { name: "London", lat: 51.5074, lon: -0.1278 },
    { name: "New York", lat: 40.7128, lon: -74.0060 },
    { name: "Tokyo", lat: 35.6895, lon: 139.6917 },
    { name: "Berlin", lat: 52.5200, lon: 13.4050 }
  ];

  for (const city of cities) {
    const forecasts = await getWeatherForecast(city.lat, city.lon);
    const result = calculateConsensus(forecasts);
    if (!result) continue;
    const { consensus, confidence } = result;

    let decision = null;
    let reason = "";
    if (confidence >= CONFIDENCE_THRESHOLD) {
      if (consensus > TEMP_UP) {
        decision = 'up';
        reason = `Консенсус ${consensus.toFixed(1)}°C > ${TEMP_UP}°C`;
      } else if (consensus < TEMP_DOWN) {
        decision = 'down';
        reason = `Консенсус ${consensus.toFixed(1)}°C < ${TEMP_DOWN}°C`;
      }
    }

    if (decision) {
      const alreadyInPosition = userState.positions.some(p => !p.closed && p.city === city.name);
      if (!alreadyInPosition) {
        let marketPrice = 0.5 + (consensus - 15) * 0.1;
        marketPrice = Math.min(0.95, Math.max(0.05, marketPrice));
        openPosition(city.name, decision, marketPrice, reason, confidence);
      }
    }
  }
}

// ======================== HTTP МАРШРУТИ ========================
app.get('/api/status', (req, res) => {
  const activePositions = userState.positions.filter(p => !p.closed);
  res.json({
    botEnabled: userState.botEnabled,
    balance: userState.balance.toFixed(2),
    dailyPnL: userState.dailyPnL.toFixed(2),
    monthlyPnL: userState.monthlyPnL.toFixed(2),
    activePositions: activePositions.length,
    positions: activePositions.map(p => ({
      city: p.city,
      direction: p.direction,
      size: p.size.toFixed(2),
      entryPrice: p.entryPrice.toFixed(2)
    })),
    balance_history: userState.balance_history
  });
});

app.post('/api/bot/toggle', (req, res) => {
  userState.botEnabled = !userState.botEnabled;
  res.json({ botEnabled: userState.botEnabled });
});

app.post('/api/scan', async (req, res) => {
  await scanAndTrade();
  res.json({ status: "scan completed" });
});

// За тестова цел – ръчно извикване на сканиране
app.get('/api/scan', async (req, res) => {
  await scanAndTrade();
  res.json({ status: "scan completed" });
});

// ======================== СТАРТИРАНЕ ========================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌤️ Polymarket Weather Bot (симулация) слуша на порт ${PORT}`);
  console.log(`📊 Отвори https://your-app.up.railway.app/ за панел`);
});

// Периодични задачи
setInterval(scanAndTrade, 30 * 60 * 1000); // на всеки 30 минути
setInterval(monitorPositions, 10 * 60 * 1000); // на всеки 10 минути
