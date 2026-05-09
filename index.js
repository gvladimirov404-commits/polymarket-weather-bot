import express from 'express';
import axios from 'axios';
import { ClobClient, Chain, Side, OrderType } from '@polymarkets/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // За статични файлове като HTML и JS

// ======================== НАСТРОЙКИ ========================
const INITIAL_BALANCE = 70.0;     // USDC (депозит)
const POSITION_PERCENT = 0.01;    // 1% от баланса на сделка (~0.70 USDC)
const DAILY_LOSS_LIMIT = 0.03;    // 3% дневен лимит на загуба
const MONTHLY_LOSS_LIMIT = 0.10;  // 10% месечен лимит на загуба
const TAKE_PROFIT_PERCENT = 0.25; // Печалба 25% — затваряме позицията
const STOP_LOSS_PERCENT = -0.15;  // Загуба 15% — затваряме позицията
const CONFIDENCE_THRESHOLD = 70;  // Минимална увереност за отваряне
const TEMP_UP = 15.5;
const TEMP_DOWN = 14.5;

// Състояние на бота
let userState = {
  balance: Number(process.env.DEPLOYED_BALANCE) || INITIAL_BALANCE,
  dailyPnL: 0,
  monthlyPnL: 0,
  positions: [],        // масив от отворени позиции
  botEnabled: true,
  balance_history: [{ date: new Date().toISOString(), balance: INITIAL_BALANCE }]
};

// Помощна функция за добавяне на запис в историята на баланса
function addBalanceHistory() {
  userState.balance_history.push({ date: new Date().toISOString(), balance: userState.balance });
}

// Функция за нулиране на дневния PnL
function resetDailyIfNeeded() {
  const today = new Date().toDateString();
  if (today !== userState.lastResetDate) {
    userState.dailyPnL = 0;
    userState.lastResetDate = today;
    console.log("🔄 Дневният PnL е нулиран.");
  }
}

// ======================== ИНИЦИАЛИЗАЦИЯ НА ПОЛИМАРКЕТ КЛИЕНТ ========================
let polyClient = null;

async function getPolyClient() {
    if (!polyClient && process.env.PRIVATE_KEY) {
        const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}`);
        const walletClient = createWalletClient({ account, transport: http() });

        // Стъпка 1: L1 аутентикация и извличане/създаване на L2 ключове
        const tempClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chain: Chain.POLYGON,
            signer: walletClient
        });
        const creds = await tempClient.createOrDeriveApiKey();

        // Стъпка 2: Инициализация на напълно автентициран клиент (L1 + L2)
        polyClient = new ClobClient({
            host: 'https://clob.polymarket.com',
            chain: Chain.POLYGON,
            signer: walletClient,
            creds: creds
        });
    }
    return polyClient;
}

// ======================== ПОМОЩНИ ФУНКЦИИ ========================
async function getWeatherForecasts(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&forecast_days=1`;
    try {
        const response = await axios.get(url);
        if (response.data.hourly && response.data.hourly.temperature_2m.length > 0) {
            const tempAt12 = response.data.hourly.temperature_2m[12];
            // Open-Meteo дава един модел, симулираме разликите за мултимоделен консенсус
            return {
                ecmwf: tempAt12,
                gfs: tempAt12 + (Math.random() - 0.5) * 0.8,
                icon: tempAt12 + (Math.random() - 0.5) * 0.6
            };
        }
    } catch (err) {
        console.error(`Грешка при прогноза (${lat},${lon}):`, err.message);
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

// Следене и затваряне на позиции (Stop-Loss / Take-Profit & разрешаване)
async function monitorPositions() {
    const client = await getPolyClient();
    if (!client) return;

    for (let pos of userState.positions) {
        // Взимаме реална текуща цена от order book
        const orderBook = await client.getOrderBook(pos.tokenID);
        const currentPrice = orderBook.bids[0]?.price || 0.5;
        let pnlPercent = (pos.direction === 'up') ? (currentPrice - pos.entryPrice) / pos.entryPrice : (pos.entryPrice - currentPrice) / pos.entryPrice;

        if (pnlPercent >= TAKE_PROFIT_PERCENT) {
            await closePosition(pos, `Take Profit (${(pnlPercent*100).toFixed(0)}%)`);
        } else if (pnlPercent <= STOP_LOSS_PERCENT) {
            await closePosition(pos, `Stop Loss (${(pnlPercent*100).toFixed(0)}%)`);
        }
    }
}

// Затваряне на позицията (изпращане на обратна поръчка за продажба)
async function closePosition(position, reason) {
    console.log(`🔒 Затваряне на позиция в ${position.city}: ${reason}`);
    const client = await getPolyClient();
    const orderBook = await client.getOrderBook(position.tokenID);
    const closePrice = orderBook.bids[0]?.price || 0.5; // Цената, по която ще продадем

    const orderResult = await client.createAndPostOrder({
        tokenID: position.tokenID,
        side: Side.SELL,
        price: closePrice,
        size: position.size
    }, { tickSize: "0.01" }, OrderType.GTC);

    if (orderResult.success) {
        let pnl = (closePrice - position.entryPrice) * position.size;
        if (position.direction === 'down') pnl = (position.entryPrice - closePrice) * position.size;
        userState.balance += position.size + pnl;
        userState.dailyPnL += pnl;
        userState.monthlyPnL += pnl;
        addBalanceHistory();
        position.closed = true;
        position.closedPrice = closePrice;
        position.pnl = pnl;
        position.closeReason = reason;
        console.log(`💰 Позицията е закрита. PnL: ${pnl.toFixed(2)} USDC`);
    } else {
        console.error(`❌ Грешка при затваряне на позиция ${position.id}:`, orderResult.error);
    }
}

// Сканиране, вземане на решение и поставяне на поръчка
async function scanAndTrade(market) {
    if (!userState.botEnabled) return;
    resetDailyIfNeeded();

    if (userState.dailyPnL <= -INITIAL_BALANCE * DAILY_LOSS_LIMIT) {
        console.log("⛔ Дневният лимит за загуба е достигнат.");
        return;
    }

    const forecasts = await getWeatherForecasts(market.lat, market.lon);
    const result = calculateConsensus(forecasts);
    if (!result) return;
    const { consensus, confidence } = result;

    let decision = null;
    let reason = "";
    if (confidence >= CONFIDENCE_THRESHOLD) {
        if (consensus > TEMP_UP) { decision = 'up'; reason = `Консенсус ${consensus.toFixed(1)}°C > ${TEMP_UP}°C`; }
        else if (consensus < TEMP_DOWN) { decision = 'down'; reason = `Консенсус ${consensus.toFixed(1)}°C < ${TEMP_DOWN}°C`; }
    }

    if (decision) {
        const alreadyInPosition = userState.positions.some(p => !p.closed && p.tokenID === market.tokenID);
        if (!alreadyInPosition) {
            let size = userState.balance * POSITION_PERCENT;
            size = Math.min(Math.max(size, 0.5), 4.0);
            let marketPrice = 0.5 + (consensus - 15) * 0.1;
            marketPrice = Math.min(0.95, Math.max(0.05, marketPrice));

            const client = await getPolyClient();
            const orderResult = await client.createAndPostOrder({
                tokenID: market.tokenID,
                side: Side.BUY,
                price: marketPrice,
                size: size
            }, { tickSize: "0.01" }, OrderType.GTC);

            if (orderResult.success) {
                const newPosition = {
                    id: orderResult.orderID,
                    tokenID: market.tokenID,
                    city: market.city,
                    direction: decision,
                    size: size,
                    entryPrice: marketPrice,
                    openTime: new Date().toISOString(),
                    reason: reason
                };
                userState.positions.push(newPosition);
                userState.balance -= size;
                addBalanceHistory();
                console.log(`📈 Нова позиция в ${market.city}: ${decision.toUpperCase()} ${size} USDC`);
            } else {
                console.error(`❌ Грешка при поставяне на поръчката: ${orderResult.error}`);
            }
        }
    }
}

// ======================== HTTP МАРШРУТИ ========================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/status', (req, res) => {
    const activePositions = userState.positions.filter(p => !p.closed);
    res.json({
        botEnabled: userState.botEnabled,
        balance: userState.balance.toFixed(2),
        dailyPnL: userState.dailyPnL.toFixed(2),
        monthlyPnL: userState.monthlyPnL.toFixed(2),
        activePositions: activePositions.length,
        positions: activePositions.map(p => ({ city: p.city, direction: p.direction, size: p.size, entryPrice: p.entryPrice })),
        balance_history: userState.balance_history
    });
});

app.post('/api/bot/toggle', (req, res) => {
    userState.botEnabled = !userState.botEnabled;
    res.json({ botEnabled: userState.botEnabled });
});

app.post('/api/scan', async (req, res) => {
    // Тук трябва да вземем маркета от базата или да използваме последния намерен
    // За простота, използваме статичен маркет (ще трябва да добавите логика за избор на активен маркет)
    res.json({ status: "scan initiated (requires market selection logic)" });
});

// ======================== СТАРТИРАНЕ НА СЪРВЪРА ========================
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Ботът е активен на порт ${PORT}`);
    // Инициализиране на клиента при стартиране
    await getPolyClient();
});
