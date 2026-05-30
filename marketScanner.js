const axios = require('axios');

let priceCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10000;
const MIN_LIQUIDITY = 5000;
const FORECAST_ACCURACY = 0.85; // 85% вярваме на прогнозата (може да се променя)
const MIN_EDGE = 0.10; // залагаме само ако нашето предимство е над 10%

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const DEFAULT_CITY = "London";

// Помощна функция за извличане на температурни прагове от текст
function parseTemperatureThreshold(outcomeText) {
    // Търси число, последвано от °C или °F или просто число
    const match = outcomeText.match(/(\d+(?:\.\d+)?)\s*°?C/i);
    if (match) return parseFloat(match[1]);
    const matchF = outcomeText.match(/(\d+(?:\.\d+)?)\s*°?F/i);
    if (matchF) return (parseFloat(matchF[1]) - 32) * 5/9;
    return null;
}

// Определя кой изход е най-вероятен според прогнозата
function determineMostLikelyOutcome(forecastTemp, outcomes, tokenIds) {
    let bestOutcome = null;
    let bestIndex = -1;
    let bestThreshold = null;

    for (let i = 0; i < outcomes.length; i++) {
        const outcome = outcomes[i];
        const threshold = parseTemperatureThreshold(outcome);
        if (threshold === null) continue;

        let isMatch = false;
        if (outcome.toLowerCase().includes('higher') || outcome.toLowerCase().includes('above')) {
            if (forecastTemp >= threshold) isMatch = true;
        } else if (outcome.toLowerCase().includes('lower') || outcome.toLowerCase().includes('below')) {
            if (forecastTemp <= threshold) isMatch = true;
        } else if (outcome.includes('-')) {
            // Диапазон като "20-25°C"
            const parts = outcome.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
            if (parts) {
                const low = parseFloat(parts[1]);
                const high = parseFloat(parts[2]);
                if (forecastTemp >= low && forecastTemp <= high) isMatch = true;
            }
        } else {
            // Точна стойност
            if (Math.abs(forecastTemp - threshold) < 0.5) isMatch = true;
        }

        if (isMatch) {
            bestOutcome = outcome;
            bestIndex = i;
            bestThreshold = threshold;
            break;
        }
    }

    if (bestOutcome === null && outcomes.length > 0) {
        // Fallback: взимаме най-близкия праг
        let minDiff = Infinity;
        for (let i = 0; i < outcomes.length; i++) {
            const th = parseTemperatureThreshold(outcomes[i]);
            if (th !== null && Math.abs(forecastTemp - th) < minDiff) {
                minDiff = Math.abs(forecastTemp - th);
                bestIndex = i;
                bestOutcome = outcomes[i];
            }
        }
    }

    return { bestIndex, bestOutcome, bestThreshold };
}

async function getWeatherForecast(city = DEFAULT_CITY) {
    if (!OPENWEATHER_API_KEY) return null;
    const today = new Date().toISOString().slice(0, 10);
    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${OPENWEATHER_API_KEY}&units=metric`;
    try {
        const response = await axios.get(url, { timeout: 5000 });
        const forecast = response.data.list.find(item => item.dt_txt.includes(today));
        if (forecast) {
            const temp = forecast.main.temp_max;
            console.log(`🌡️ Прогноза за ${city} на ${today}: ${temp}°C`);
            return temp;
        }
    } catch (err) {
        console.error("Грешка при OpenWeatherMap:", err.message);
    }
    return null;
}

async function refreshLiquidMarkets() {
    if (priceCache && (Date.now() - cacheTimestamp) < CACHE_TTL) return priceCache;

    const url = 'https://gamma-api.polymarket.com/markets?closed=false&limit=50';
    try {
        console.log("🔍 Търся метеорологични пазари...");
        const response = await axios.get(url, { timeout: 10000 });
        const markets = response.data;

        if (!markets || markets.length === 0) return { success: false, error: "Няма пазари" };

        const weatherMarkets = markets.filter(m => {
            const q = (m.question || "").toLowerCase();
            return q.includes('temperature') || q.includes('temp') || q.includes('weather') || q.includes('celsius');
        });

        if (weatherMarkets.length === 0) return { success: false, error: "Няма метеорологични пазари" };

        weatherMarkets.sort((a, b) => (b.volume || 0) - (a.volume || 0));
        const best = weatherMarkets[0];
        const volume = best.volume || best.volume24hr || 0;
        console.log(`🌤️ Избран пазар: ${best.question}`);
        console.log(`💰 Обем: $${volume.toLocaleString()}`);

        const forecastTemp = await getWeatherForecast();
        if (forecastTemp === null) {
            console.log("⚠️ Няма прогноза – няма да търгувам");
            return { success: false, error: "No forecast" };
        }

        let outcomes = [];
        if (best.outcomes) {
            try {
                outcomes = typeof best.outcomes === 'string' ? JSON.parse(best.outcomes) : best.outcomes;
            } catch(e) { outcomes = []; }
        }
        let tokenIds = [];
        if (best.clobTokenIds) {
            try {
                tokenIds = typeof best.clobTokenIds === 'string' ? JSON.parse(best.clobTokenIds) : best.clobTokenIds;
            } catch(e) { tokenIds = []; }
        }

        if (outcomes.length === 0 || tokenIds.length === 0) {
            console.log("❌ Пазарът няма outcomes или токени");
            return { success: false, error: "No outcomes/tokens" };
        }

        const { bestIndex, bestOutcome } = determineMostLikelyOutcome(forecastTemp, outcomes, tokenIds);
        if (bestIndex === -1) {
            console.log("❌ Не мога да определя най-вероятния изход");
            return { success: false, error: "Cannot map forecast" };
        }

        // Цени от outcomePrices
        let marketPrices = [];
        if (best.outcomePrices) {
            try {
                marketPrices = typeof best.outcomePrices === 'string' ? JSON.parse(best.outcomePrices) : best.outcomePrices;
                marketPrices = marketPrices.map(p => parseFloat(p)).filter(p => !isNaN(p));
            } catch(e) { marketPrices = []; }
        }

        if (marketPrices.length < outcomes.length) {
            console.log("❌ Няма достатъчно цени за изходите");
            return { success: false, error: "Price mismatch" };
        }

        const myProb = FORECAST_ACCURACY; // честна вероятност за избрания изход
        const marketProb = marketPrices[bestIndex];
        const edge = myProb - marketProb;

        console.log(`📊 Изход "${bestOutcome}" → цена на пазара: ${marketProb}, моя вероятност: ${myProb}, edge: ${(edge*100).toFixed(1)}%`);

        if (edge < MIN_EDGE) {
            console.log(`⏭️ Edge (${(edge*100).toFixed(1)}%) < минималния (${MIN_EDGE*100}%) – няма да залагам`);
            return { success: false, error: "No edge" };
        }

        // Определяме основния залог (най-вероятния изход) и хеджовете (останалите)
        let mainToken = tokenIds[bestIndex];
        let otherTokens = tokenIds.filter((_, idx) => idx !== bestIndex);
        let hedgeUpToken = otherTokens[0] || null;
        let hedgeDownToken = otherTokens[1] || null;

        const result = {
            success: true,
            title: best.question,
            tokens: [mainToken, hedgeUpToken, hedgeDownToken],
            liquidity: volume,
            prices: {
                main: marketPrices[bestIndex],
                hedgeUp: otherTokens[0] !== undefined ? marketPrices[otherTokens[0]] : 0.05,
                hedgeDown: otherTokens[1] !== undefined ? marketPrices[otherTokens[1]] : 0.05
            },
            edge: edge
        };

        priceCache = result;
        cacheTimestamp = Date.now();
        return result;

    } catch (err) {
        console.error("❌ Грешка:", err.message);
        if (priceCache) return priceCache;
        return { success: false, error: err.message };
    }
}

module.exports = { refreshLiquidMarkets };
