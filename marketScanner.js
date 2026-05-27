const axios = require('axios');

let priceCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10000;

// ФИКСИРАН ПАЗАР – директно с токените от API-то
const FIXED_MARKET = {
    question: "New Rihanna Album before GTA VI?",
    conditionId: "0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be",
    tokens: [
        "98022490269692409998126496127597032490334070080325855126491859374983463996227",
        "53831553061883006530739877284105938919721408776239639687877978808906551086026"
    ],
    volume: 766438,
    outcomePrices: ["0.525", "0.475"]
};

async function refreshLiquidMarkets() {
    if (priceCache && (Date.now() - cacheTimestamp) < CACHE_TTL) {
        console.log("📦 Кеш");
        return priceCache;
    }

    try {
        // Опитваме се да вземем актуални цени за фиксирания пазар
        const url = `https://gamma-api.polymarket.com/markets?conditionId=${FIXED_MARKET.conditionId}`;
        const response = await axios.get(url, { timeout: 10000 });
        const marketData = response.data?.[0];
        
        let mainPrice = 0.50, hedgeUp = 0.30, hedgeDown = 0.20;
        let volume = FIXED_MARKET.volume;
        
        if (marketData) {
            volume = marketData.volume || marketData.volume24hr || FIXED_MARKET.volume;
            
            if (marketData.outcomePrices) {
                let prices = [];
                if (Array.isArray(marketData.outcomePrices)) {
                    prices = marketData.outcomePrices.map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0);
                } else if (typeof marketData.outcomePrices === 'string') {
                    try {
                        const parsed = JSON.parse(marketData.outcomePrices);
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
        }

        console.log(`🎯 ФИКСИРАН ПАЗАР: ${FIXED_MARKET.question}`);
        console.log(`💰 Обем: $${volume.toLocaleString()}`);
        console.log(`✅ Цени: Main=${mainPrice.toFixed(3)}, Up=${hedgeUp.toFixed(3)}, Down=${hedgeDown.toFixed(3)}`);

        const result = {
            success: true,
            title: FIXED_MARKET.question,
            conditionId: FIXED_MARKET.conditionId,
            tokens: FIXED_MARKET.tokens,
            liquidity: volume,
            prices: { main: mainPrice, hedgeUp, hedgeDown }
        };

        priceCache = result;
        cacheTimestamp = Date.now();
        return result;

    } catch (err) {
        console.error("❌ Грешка:", err.message);
        if (priceCache) return priceCache;
        
        // Fallback – връщаме фиксираните данни, ако няма връзка
        return {
            success: true,
            title: FIXED_MARKET.question,
            conditionId: FIXED_MARKET.conditionId,
            tokens: FIXED_MARKET.tokens,
            liquidity: FIXED_MARKET.volume,
            prices: { main: 0.525, hedgeUp: 0.475, hedgeDown: 0.237 }
        };
    }
}

module.exports = { refreshLiquidMarkets };
