const axios = require('axios');

let priceCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10000;

// ФИКСИРАН ДЪЛГОСРОЧЕН ПАЗАР – Will bitcoin hit $1M by 2030?
const MARKET = {
    question: "Will bitcoin hit $1M by 2030?",
    conditionId: "0xbb57ccf5853a85487bc3d83d04d669310d28c6c810758953b9d9b91d1aee89d2",
    tokens: [
        "105267568073659068217311993901927962476298440625043565106676088842803600775810",
        "91863162118308663069733924043159186005106558783397508844234610341221325526200"
    ]
};

async function refreshLiquidMarkets() {
    if (priceCache && (Date.now() - cacheTimestamp) < CACHE_TTL) return priceCache;

    try {
        console.log(`🎯 ФИКСИРАН ДЪЛГОСРОЧЕН ПАЗАР: ${MARKET.question}`);
        
        const url = `https://gamma-api.polymarket.com/markets?conditionId=${MARKET.conditionId}`;
        const response = await axios.get(url, { timeout: 10000 });
        const market = response.data?.[0];
        
        let mainPrice = 0.50, hedgeUp = 0.30, hedgeDown = 0.20;
        let volume = 1000000;
        
        if (market) {
            volume = market.volume || market.volume24hr || 1000000;
            if (market.outcomePrices) {
                let prices = [];
                if (Array.isArray(market.outcomePrices)) {
                    prices = market.outcomePrices.map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0);
                } else if (typeof market.outcomePrices === 'string') {
                    try {
                        const parsed = JSON.parse(market.outcomePrices);
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

        console.log(`💰 Обем: $${volume.toLocaleString()}`);
        console.log(`✅ Цени: Yes=${mainPrice.toFixed(3)}, No=${hedgeUp.toFixed(3)}`);

        const result = {
            success: true,
            title: MARKET.question,
            tokens: MARKET.tokens,
            liquidity: volume,
            prices: { main: mainPrice, hedgeUp, hedgeDown }
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
