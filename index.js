import express from 'express';
import axios from 'axios';
import { ClobClient, Chain, Side, OrderType } from '@polymarkets/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// ======================== НАСТРОЙКИ ========================
// Заредени от Railway -> Variables
const POLY_PRIVATE_KEY = process.env.PRIVATE_KEY;
const CLOB_API_KEY = process.env.CLOB_API_KEY;
const CLOB_SECRET = process.env.CLOB_SECRET;
const CLOB_PASS_PHRASE = process.env.CLOB_PASS_PHRASE;
const WINDY_API_KEY = process.env.WINDY_API_KEY;

// Параметри на стратегията и риск мениджмънта
const RISK = {
  PORTFOLIO_USD: 70.0,        // Начален депозит (USDC)
  POSITION_PERCENT: 0.007,    // 0.7% от портфейла на сделка (~0.50 USDC)
  DAILY_LOSS_LIMIT: 0.03,     // 3% дневен лимит на загуба
  MONTHLY_LOSS_LIMIT: 0.10,   // 10% месечен лимит на загуба
  TAKE_PROFIT: 0.25,          // Печалба 25% — затваряме
  STOP_LOSS: -0.15,           // Загуба 15% — затваряме
  CONFIDENCE_THRESHOLD: 75    // Увереност (confidence >= 75%) за влизане
};

// Глобално състояние на бота
let userState = {
  balance: RISK.PORTFOLIO_USD,
  dailyPnL: 0,
  monthlyPnL: 0,
  positions: [],    // масив от отворени позиции
  botEnabled: true
};

// ======================== ПОМОЩНИ ФУНКЦИИ ========================
// 1. Работа с CLOB клиента
let polyClient = null;
async function getPolyClient() {
  if (!polyClient) {
    const account = privateKeyToAccount(POLY_PRIVATE_KEY);
    const walletClient = createWalletClient({ account, transport: http() });
    const creds = {
      key: CLOB_API_KEY,
      secret: CLOB_SECRET,
      passphrase: CLOB_PASS_PHRASE
    };
    polyClient = new ClobClient({
      host: 'https://clob.polymarket.com',
      chain: Chain.POLYGON,
      signer: walletClient,
      creds
    });
  }
  return polyClient;
}

// 2. Вземане на метеорологични данни от Windy API (ECMWF, GFS, ICON)
async function getWeatherForecasts(city, lat, lon) {
  try {
    const url = `https://api.windy.com/api/point-forecast/v2?lat=${lat}&lon=${lon}&model=ecmwf,gfs,icon&parameters=temperature&key=${WINDY_API_KEY}`;
    const response = await axios.get(url);
    const models = response.data.models;
    if (models && models.ecmwf && models.gfs && models.icon) {
      const ecmwf = models.ecmwf.temperature[0];
      const gfs = models.gfs.temperature[0];
      const icon = models.icon.temperature[0];
      return { ecmwf, gfs, icon };
    }
  } catch (err) {
    console.error("Windy API error:", err.message);
  }
  // Ако има грешка, връщаме тестови стойности, за да не спира бота
  console.warn("⚠️ Вече тестваме симулирани данни (вместо реальна прогноза)");
  return { ecmwf: 12.5, gfs: 13.0, icon: 14.0 };
}

// 3. Изчисляване на консенсус и увереност
function calculateConsensus(models) {
  const temps = [models.ecmwf, models.gfs, models.icon];
  const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
  const variance = temps.map(t => Math.pow(t - mean, 2)).reduce((a, b) => a + b, 0) / temps.length;
  let confidence = Math.min(100, Math.max(0, 100 - variance * 20));
  return { consensus: mean, confidence };
}

// 4. Намиране на най-ликвидния пазар (Gamma API)
let selectedMarket = null;
let lastMarketRefresh = 0;
async function getBestCityMarket() {
  const now = Date.now();
  if (selectedMarket && (now - lastMarketRefresh) < 6 * 3600 * 1000) return selectedMarket;

  const url = 'https://gamma-api.polymarket.com/markets?closed=false&order=liquidity_num:desc&limit=10'; // Взимаме най-ликвидните
  try {
    const res = await axios.get(url);
    const markets = res.data;
    // Търсим пазар за време (може да се търсят и self-custody пазари)
    const weatherMarket = markets.find(m => m.question && m.question.includes("temperature") && m.liquidity_num > 2000);
    if (weatherMarket) {
      selectedMarket = {
        city: weatherMarket.title || weatherMarket.question,
        tokenID: weatherMarket.clob_token_ids[0], // обикновено първият токен е YES
        question: weatherMarket.question
      };
      lastMarketRefresh = now;
      console.log(`🎯 Пазарът за "${selectedMarket.city}" ликвиден, ще следим.`);
      return selectedMarket;
    }
  } catch (err) { console.error("Gamma API error:", err); }

  // fallback — примерен пазар (може да го смениш с реален токен)
  return { city: "Sofia", tokenID: "0x...", question: "Sofia temperature >12C?" };
}

// 5. Поръчка в Polymarket
async function placeOrder(direction, size, price) {
  const client = await getPolyClient();
  const side = direction === 'up' ? Side.BUY : Side.SELL;
  // Ограничителна поръчка (Limit Order)
  const result = await client.createAndPostOrder(
    { tokenID: selectedMarket.tokenID, price, side, size },
    { tickSize: "0.01" },
    OrderType.GTC
  );
  return result;
}

// 6. Автоматично затваряне на позиция (StopLoss/TakeProfit & пазарно разрешаване)
async function closePosition(position, reason) {
  console.log(`🔒 Затваряне на ${reason}: ${position.direction} @ ${position.entryPrice}`);
  // Взимаме текущата цена
  const client = await getPolyClient();
  const orderBook = await client.getOrderBook(selectedMarket.tokenID);
  const currentPrice = orderBook.bids[0]?.price || 0.5;
  let closedPrice = currentPrice;
  // Изчисляване на PnL
  let pnl = 0;
  if (position.direction === 'up') pnl = (closedPrice - position.entryPrice) * position.size;
  else pnl = (position.entryPrice - closedPrice) * position.size;
  userState.balance += position.size + pnl; // Затваряме позиция (връщаме капитал + печалба)
  userState.dailyPnL += pnl;
  userState.monthlyPnL += pnl;
  position.closedAt = new Date();
  position.closedPrice = closedPrice;
  position.pnl = pnl;
  userState.positions = userState.positions.filter(p => p.id !== position.id);
  console.log(`💰 Позицията е затворена. PnL: ${pnl.toFixed(2)} USDC`);
}

// Проверка на съществуващите позиции за TP/SL или разрешен пазар
async function monitorPositions() {
  for (let pos of userState.positions) {
    const client = await getPolyClient();
    const orderBook = await client.getOrderBook(selectedMarket.tokenID);
    const currentPrice = orderBook.bids[0]?.price || 0.5;
    let pnlPercent = (pos.direction === 'up')
      ? (currentPrice - pos.entryPrice) / pos.entryPrice
      : (pos.entryPrice - currentPrice) / pos.entryPrice;

    if (pnlPercent >= RISK.TAKE_PROFIT) {
      await closePosition(pos, `Take Profit (${(pnlPercent*100).toFixed(0)}%)`);
    } else if (pnlPercent <= RISK.STOP_LOSS) {
      await closePosition(pos, `Stop Loss (${(pnlPercent*100).toFixed(0)}%)`);
    }
  }
}

// ======================== HTTP МАРШРУТИ ========================
app.get('/status', (req, res) => {
  res.json({
    botEnabled: userState.botEnabled,
    balance: userState.balance,
    dailyPnL: userState.dailyPnL,
    monthlyPnL: userState.monthlyPnL,
    activePositions: userState.positions.length,
    positions: userState.positions.map(p => ({ direction: p.direction, size: p.size, entry: p.entryPrice, pnl: p.pnl || 0 }) )
  });
});

app.get('/trade/decision', async (req, res) => {
  if (!userState.botEnabled) return res.status(403).json({ error: "Bot is disabled" });

  // Избор на пазар (актуализира се на всеки 6 часа)
  const market = await getBestCityMarket();
  if (!market) return res.status(404).json({ error: "No liquid market found" });

  // Вземане на метеорологичната прогноза за този град (ще използваме примерни координати)
  // Можеш да добавиш географски координати за всеки град в база данни
  const lat = 42.6977, lon = 23.3219; // София (тестови)
  const forecasts = await getWeatherForecasts(market.city, lat, lon);
  const { consensus, confidence } = calculateConsensus(forecasts);

  let decision = 'hold';
  let reason = '';
  if (consensus > 15.5 && confidence >= RISK.CONFIDENCE_THRESHOLD) {
    decision = 'up';
    reason = `Консенсус ${consensus.toFixed(1)}°C > 15.5°C, увереност ${confidence}%`;
  } else if (consensus < 14.5 && confidence >= RISK.CONFIDENCE_THRESHOLD) {
    decision = 'down';
    reason = `Консенсус ${consensus.toFixed(1)}°C < 14.5°C, увереност ${confidence}%`;
  } else {
    reason = `Консенсус в неутралната зона или увереността е ниска.`;
  }

  if (decision !== 'hold') {
    // Управление на риска: сделка само в рамките на дневния и месечния лимит
    let maxLossToday = userState.balance * RISK.DAILY_LOSS_LIMIT;
    let maxLossMonth = userState.balance * RISK.MONTHLY_LOSS_LIMIT;
    if (userState.dailyPnL < -maxLossToday || userState.monthlyPnL < -maxLossMonth) {
      await res.json({ decision: 'hold', status: "risk_breach", reason: "Лимитът за загуба е достигнат" });
      return;
    }

    let size = userState.balance * RISK.POSITION_PERCENT;
    if (size < 0.5) size = 0.5;
    if (size > 4.0) size = 4.0; // ограничаваме максималния залог до 4 USDC

    let marketPrice = (consensus - 15) * 0.1 + 0.5;
    marketPrice = Math.min(0.95, Math.max(0.05, marketPrice));

    const orderResult = await placeOrder(decision, size, marketPrice);
    if (orderResult.success) {
      const newPosition = {
        id: orderResult.orderID,
        direction: decision,
        size: size,
        entryPrice: marketPrice,
        openTime: new Date().toISOString(),
        tokenID: market.tokenID,
        city: market.city,
        reason
      };
      userState.positions.push(newPosition);
      userState.balance -= size;
      await res.json({ decision, orderId: orderResult.orderID, price: marketPrice, reason, size });
    } else {
      await res.status(500).json({ error: `Неуспешна поръчка: ${orderResult.error}` });
    }
  } else {
    await res.json({ decision: 'hold', reason });
  }
});

app.post('/bot/toggle', (req, res) => {
  userState.botEnabled = !userState.botEnabled;
  res.json({ botEnabled: userState.botEnabled });
});

// Затваряне на стари позиции на всеки 2 минути
setInterval(monitorPositions, 2 * 60 * 1000);

// Стартиране
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Ботът стартира на порт ${PORT}`);
});
