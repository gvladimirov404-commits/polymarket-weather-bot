const axios = require('axios');

// Кеш система за цените (5 секунди TTL)
let priceCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5000; // 5 секунди

// Минимална ликвидност за търгуване (USD)
const MIN_LIQUIDITY = 5000;

// Ключови думи за метеорологични пазари (английски, български, руски)
const WEATHER_KEYWORDS = [
    // Английски
    'temperature', 'temp', 'weather', 'forecast',
    'rain', 'snow', 'wind', 'storm', 'hurricane',
    'celsius', 'fahrenheit', 'climate', 'meteo',
    'highest temperature', 'lowest temperature', 'heat wave',
    // Български
    'температура', 'време', 'дъжд', 'сняг', 'буря', 'град',
    'най-висока', 'най-ниска', 'прогноза',
    // Руски
    'погода', 'температура', 'дождь', 'снег', 'буря', 'град',
    'прогноз', 'самая высокая', 'самая низкая'
];

/**
 * Основна функция за сканиране на Polymarket
 * Връща най-ликвидния метеорологичен пазар с живи цени
 */
async function refreshLiquidMarkets() {
    // Връщаме кеширани данни, ако са все още валидни
    if (priceCache && (Date.now() - cacheTimestamp) < CACHE_TTL) {
        console.log("📦 Връщам кеширани цени");
        return priceCache;
    }

    const url = 'https://gamma-api.polymarket.com/markets?closed=false&order=liquidity_num:desc&limit=50';
    
    try {
        console.log("🔍 Сканирам Polymarket за метео пазари...");
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'HyperMeteo-Bot/1.0'
            }
        });
        
        const markets = response.data;
        
        if (!markets || markets.length === 0) {
            console.log("⚠️ Няма намерени активни пазари");
            return { success: false, error: "No active markets" };
        }

        // Филтриране само за метеорологични пазари
        const weatherMarkets = markets.filter(market => {
            if (!market.question) return false;
            const questionLower = market.question.toLowerCase();
            return WEATHER_KEYWORDS.some(keyword => questionLower.includes(keyword.toLowerCase()));
        });

        if (weatherMarkets.length === 0) {
            console.log("⚠️ Няма намерени метеорологични пазари");
            // За дебъг: покажи първите 3 заглавия
            if (markets.length > 0) {
                console.log("📋 Примерни заглавия от API:");
                for (let i = 0; i < Math.min(3, markets.length); i++) {
                    console.log(`   - ${markets[i].question}`);
                }
            }
            return { success: false, error: "No weather markets found" };
        }

        // Вземаме най-ликвидния метео пазар
        const bestMarket = weatherMarkets[0];
        const liquidity = bestMarket.liquidity_num || 0;

        console.log(`🌤️ Намерен пазар: ${bestMarket.question}`);
        console.log(`💧 Ликвидност: $${liquidity.toLocaleString()}`);

        // Проверка за минимална ликвидност
        if (liquidity < MIN_LIQUIDITY) {
            console.log(`⚠️ Ликвидността ($${liquidity}) е под минималната ($${MIN_LIQUIDITY})`);
            return { success: false, error: `Low liquidity: $${liquidity}` };
        }

        // Извличане на цените (outcomePrices) или default стойности
        let mainPrice = 0.70;
        let hedgeUpPrice = 0.05;
        let hedgeDownPrice = 0.05;

        if (bestMarket.outcomePrices && Array.isArray(bestMarket.outcomePrices)) {
            const prices = bestMarket.outcomePrices.map(p => parseFloat(p)).filter(p => !isNaN(p));
            if (prices.length >= 1) mainPrice = prices[0];
            if (prices.length >= 2) hedgeUpPrice = prices[1];
            if (prices.length >= 3) hedgeDownPrice = prices[2];
        }

        // Валидация на токените
        let tokens = [];
        if (bestMarket.clob_token_ids && Array.isArray(bestMarket.clob_token_ids)) {
            tokens = bestMarket.clob_token_ids.slice(0, 3);
        }

        // Формиране на резултата
        const result = {
            success: true,
            title: bestMarket.question,
            description: bestMarket.description || bestMarket.question,
            tokens: tokens,
            liquidity: liquidity,
            prices: {
                main: mainPrice,
                hedgeUp: hedgeUpPrice,
                hedgeDown: hedgeDownPrice
            },
            endDate: bestMarket.endDate || null,
            volume: bestMarket.volume_num || 0
        };

        // Запазваме в кеша
        priceCache = result;
        cacheTimestamp = Date.now();

        console.log(`✅ Цени заредени: Main=${mainPrice}, Up=${hedgeUpPrice}, Down=${hedgeDownPrice}`);
        
        return result;

    } catch (error) {
        console.error("❌ Грешка при сканиране на Polymarket:", error.message);
        
        // Ако има кеш, връщаме него (дори да е стар) преди да върнем грешка
        if (priceCache) {
            console.log("⚠️ Връщам стари кеширани данни поради грешка");
            return priceCache;
        }
        
        return { 
            success: false, 
            error: error.message,
            // Fallback данни за авариен режим
            prices: { main: 0.70, hedgeUp: 0.05, hedgeDown: 0.05 }
        };
    }
}

/**
 * Функция за принудително опресняване на кеша
 */
async function forceRefresh() {
    priceCache = null;
    cacheTimestamp = 0;
    return await refreshLiquidMarkets();
}

/**
 * Проверка дали пазарът все още е активен
 */
async function isMarketActive() {
    const market = await refreshLiquidMarkets();
    if (!market.success) return false;
    
    // Ако има крайна дата и е минала, пазарът е затворен
    if (market.endDate && new Date(market.endDate) < new Date()) {
        return false;
    }
    
    return true;
}

// Експорт на всички полезни функции
module.exports = {
    refreshLiquidMarkets,
    forceRefresh,
    isMarketActive,
    MIN_LIQUIDITY,
    WEATHER_KEYWORDS
};
