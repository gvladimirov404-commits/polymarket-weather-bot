const axios = require('axios');

let priceCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10000;

// ФИКСИРАН ПАЗАР – GTA VI released before June 2026?
const MARKET = {
    question: "GTA VI released before June 2026?",
    conditionId: "0xcccb7e7613a087c132b69cbf3a02bece3fdcb824c1da54ae79acc8d4a562d902",
    tokens: [
        "8441400852834915183759801017793514978104486628517653995211751018945988243154",
        "109289569086508934142323222102974769075074494425163878721602922903101062859033"
    ]
};

async function refreshLiquidMarkets() {
    if (priceCache && (Date.now() - cacheTimestamp) < CACHE_TTL) return priceCache;

    try {
        console.log(`🎯 ФИКСИРАН ПАЗАР: ${MARKET.question}`);
        
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
