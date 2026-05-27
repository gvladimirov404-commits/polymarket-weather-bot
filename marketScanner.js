const axios = require('axios');

// Кеш система за цените (10 секунди TTL)
let priceCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10000;

// Минимална ликвидност за търгуване (USD)
const MIN_LIQUIDITY = 5000;

// Брой пазари за сканиране
const LIMIT = 50;

/**
 * Универсален скенер за Polymarket
 * Връща най-ликвидния активен пазар, независимо от категорията
 */
async function refreshLiquidMarkets() {
    // Връщаме кеширани данни, ако са все още валидни
    if (priceCache && (Date.now() - cacheTimestamp) < CACHE_TTL) {
        console.log("📦 Връщам кеширани данни");
        return priceCache;
    }

    const url = `https://gamma-api.polymarket.com/markets?closed=false&limit=${LIMIT}`;
    
    try {
        console.log("🔍 Сканирам Polymarket за най-ликвидни пазари...");
        const response = await axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'HyperMeteo-Bot/2.0'
            }
        });
        
        const markets = response.data;
        
        if (!markets || markets.length === 0) {
            console.log("⚠️ Няма намерени активни пазари");
            return { success: false, error: "No active markets" };
        }

        // Сортиране по обем на търговия (най-ликвидни отгоре)
        const sortedMarkets = [...markets].sort((a, b) => {
            const volumeA = a.volume || a.volume24hr || 0;
            const volumeB = b.volume || b.volume24hr || 0;
            return volumeB - volumeA;
        });

        // Вземаме най-ликвидния пазар
        const bestMarket = sortedMarkets[0];
        const volume = bestMarket.volume || bestMarket.volume24hr || 0;
        const liquidity = bestMarket.liquidity_num || volume;

        console.log(`📊 Избран пазар: ${bestMarket.question}`);
        console.log(`💰 Обем: $${volume.toLocaleString()}`);
        console.log(`💧 Ликвидност: $${liquidity.toLocaleString()}`);

        // Проверка за минимална ликвидност
        if (liquidity < MIN_LIQUIDITY && volume < MIN_LIQUIDITY) {
            console.log(`⚠️ Ликвидността/обемът ($${Math.max(liquidity, volume)}) е под минималния ($${MIN_LIQUIDITY})`);
            return { success: false, error: `Low liquidity: $${Math.max(liquidity, volume)}` };
        }

        // Извличане на цените (outcomePrices) или fallback стойности
        let mainPrice = 0.50;
        let hedgeUpPrice = 0.25;
        let hedgeDownPrice = 0.25;

        if (bestMarket.outcomePrices && Array.isArray(bestMarket.outcomePrices)) {
            const prices = bestMarket.outcomePrices
                .map(p => parseFloat(p))
                .filter(p => !isNaN(p) && p > 0 && p < 1);
            
            if (prices.length >= 3) {
                // Ако има 3 изхода, подреждаме ги по вероятност
                const sortedPrices = [...prices].sort((a, b) => b - a);
                mainPrice = sortedPrices[0];
                hedgeUpPrice = sortedPrices[1];
                hedgeDownPrice = sortedPrices[2];
            } else if (prices.length === 2) {
                mainPrice = Math.max(prices[0], prices[1]);
                hedgeUpPrice = Math.min(prices[0], prices[1]);
                hedgeDownPrice = Math.min(prices[0], prices[1]) * 0.5;
            } else if (prices.length === 1) {
                mainPrice = prices[0];
                hedgeUpPrice = prices[0] * 0.7;
                hedgeDownPrice = prices[0] * 0.3;
            }
        }

        // Валидация на токените (CLOB token IDs)
        let tokens = [];
        if (bestMarket.clob_token_ids && Array.isArray(bestMarket.clob_token_ids)) {
            tokens = bestMarket.clob_token_ids.slice(0, 3);
        } else if (bestMarket.tokens && Array.isArray(bestMarket.tokens)) {
            tokens = bestMarket.tokens.slice(0, 3);
        }

        // Формиране на резултата
        const result = {
            success: true,
            title: bestMarket.question,
            description: bestMarket.description || bestMarket.question,
            tokens: tokens,
            liquidity: liquidity,
            volume: volume,
            prices: {
                main: mainPrice,
                hedgeUp: hedgeUpPrice,
                hedgeDown: hedgeDownPrice
            },
            endDate: bestMarket.endDate || null,
            marketUrl: `https://polymarket.com/event/${bestMarket.slug || bestMarket.id}`,
            category: bestMarket.category || 'general'
        };

        // Запазваме в кеша
        priceCache = result;
        cacheTimestamp = Date.now();

        console.log(`✅ Цени заредени: Main=${mainPrice.toFixed(3)}, Up=${hedgeUpPrice.toFixed(3)}, Down=${hedgeDownPrice.toFixed(3)}`);
        console.log(`🔗 Пазар: ${result.marketUrl}`);
        
        return result;

    } catch (error) {
        console.error("❌ Грешка при сканиране на Polymarket:", error.message);
        
        // Ако има кеш, връщаме него (дори да е стар)
        if (priceCache) {
            console.log("⚠️ Връщам стари кеширани данни поради грешка");
            return priceCache;
        }
        
        return { 
            success: false, 
            error: error.message,
            prices: { main: 0.50, hedgeUp: 0.25, hedgeDown: 0.25 }
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
    
    if (market.endDate && new Date(market.endDate) < new Date()) {
        console.log(`⏰ Пазарът "${market.title}" е приключил на ${market.endDate}`);
        return false;
    }
    
    return true;
}

/**
 * Получаване на множество пазари (за диверсификация)
 */
async function getTopMarkets(limit = 5) {
    const url = `https://gamma-api.polymarket.com/markets?closed=false&limit=${Math.min(limit, 50)}`;
    
    try {
        const response = await axios.get(url, { timeout: 10000 });
        const markets = response.data;
        
        if (!markets || markets.length === 0) return [];
        
        return markets
            .sort((a, b) => (b.volume || 0) - (a.volume || 0))
            .slice(0, limit)
            .map(m => ({
                title: m.question,
                volume: m.volume || m.volume24hr || 0,
                url: `https://polymarket.com/event/${m.slug || m.id}`
            }));
    } catch (err) {
        console.error("Грешка при получаване на топ пазари:", err.message);
        return [];
    }
}

// Експорт на всички функции
module.exports = {
    refreshLiquidMarkets,
    forceRefresh,
    isMarketActive,
    getTopMarkets,
    MIN_LIQUIDITY
};
