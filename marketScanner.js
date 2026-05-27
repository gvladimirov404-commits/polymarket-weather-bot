const axios = require('axios');

let priceCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10000;
const MIN_VOLUME = 10000;

// Категории за търсене
const CATEGORIES = ['crypto', 'politics', 'sports'];

async function refreshLiquidMarkets() {
    if (priceCache && (Date.now() - cacheTimestamp) < CACHE_TTL) {
        console.log("📦 Кеш");
        return priceCache;
    }

    // Търсим в няколко категории
    let allMarkets = [];
    for (const category of CATEGORIES) {
        const url = `https://gamma-api.polymarket.com/markets?closed=false&category=${category}&limit=30`;
        try {
            const response = await axios.get(url, { timeout: 5000 });
            if (response.data && response.data.length) {
                allMarkets = allMarkets.concat(response.data);
                console.log(`📁 Категория ${category}: ${response.data.length} пазара`);
            }
        } catch (err) {
            console.log(`⚠️ Грешка при категория ${category}: ${err.message}`);
        }
    }

    if (allMarkets.length === 0) {
        return { success: false, error: "Няма пазари в категориите" };
    }

    // Филтрираме само пазари с токени и достатъчен обем
    const validMarkets = allMarkets.filter(m => {
        const hasTokens = m.clobTokenIds && Array.isArray(m.clobTokenIds) && m.clobTokenIds.length >= 2;
        const volume = m.volume || m.volume24hr || 0;
        return hasTokens && volume >= MIN_VOLUME;
    });

    if (validMarkets.length === 0) {
        console.log("⚠️ Няма пазари с токени и достатъчен обем");
        return { success: false, error: "Няма ликвидни пазари" };
    }

    // Сортираме по обем и взимаме най-ликвидния
    validMarkets.sort((a, b) => (b.volume || 0) - (a.volume || 0));
    const best = validMarkets[0];
    const volume = best.volume || best.volume24hr || 0;
    const tokens = best.clobTokenIds;

    console.log(`🎯 ИЗБРАН ПАЗАР: ${best.question}`);
    console.log(`📂 Категория: ${best.category || 'unknown'}`);
    console.log(`💰 Обем: $${volume.toLocaleString()}`);
    console.log(`🎫 Токени: ${tokens.length}`);

    // Цени
    let mainPrice = 0.50, hedgeUp = 0.30, hedgeDown = 0.20;
    if (best.outcomePrices) {
        let prices = [];
        if (Array.isArray(best.outcomePrices)) {
            prices = best.outcomePrices.map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0);
        } else if (typeof best.outcomePrices === 'string') {
            try {
                const parsed = JSON.parse(best.outcomePrices);
                if (Array.isArray(parsed)) {
                    prices = parsed.map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0);
                }
            } catch(e) {}
        }
        
        if (prices.length >= 2) {
            prices.sort((a, b) => b - a);
            mainPrice = prices[0];
            hedgeUp = prices[1];
            hedgeDown = prices.length >= 3 ? prices[2] : prices[1] * 0.5;
        }
    }

    console.log(`✅ Цени: Main=${mainPrice.toFixed(3)}, Up=${hedgeUp.toFixed(3)}, Down=${hedgeDown.toFixed(3)}`);

    const result = {
        success: true,
        title: best.question,
        category: best.category,
        tokens: tokens.slice(0, 3),
        liquidity: volume,
        prices: { main: mainPrice, hedgeUp, hedgeDown }
    };

    priceCache = result;
    cacheTimestamp = Date.now();
    return result;
}

module.exports = { refreshLiquidMarkets };
