const axios = require('axios');

let priceCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10000;

// ФИКСИРАН ПАЗАР – New Rihanna Album before GTA VI?
const MARKET = {
    question: "New Rihanna Album before GTA VI?",
    conditionId: "0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be",
    tokens: [
        "98022490269692409998126496127597032490334070080325855126491859374983463996227",
        "53831553061883006530739877284105938919721408776239639687877978808906551086026"
    ]
};

async function refreshLiquidMarkets() {
    if (priceCache && (Date.now() - cacheTimestamp) < CACHE_TTL) {
        return priceCache;
    }

    try {
        const url = `https://gamma-api.polymarket.com/markets?conditionId=${MARKET.conditionId}`;
        const response = await axios.get(url, { timeout: 10000 });
        const market = response.data?.[0];
        
        let mainPrice = 0.525;
        let hedgeUp = 0.475;
        let hedgeDown = 0.237;
        let liquidity = 24000;
        
        if (market) {
            liquidity = market.liquidityNum || market.liquidity || 24000;
            
            if (market.outcomePrices) {
                let prices = [];
                if (Array.isArray(market.outcomePrices)) {
                    prices = market.outcomePrices.map(v => parseFloat(v));
                } else if (typeof market.outcomePrices === 'string') {
                    try {
                        prices = JSON.parse(market.outcomePrices).map(v => parseFloat(v));
                    } catch(e) {}
                }
                if (prices.length >= 2) {
                    prices.sort((a, b) => b - a);
                    mainPrice = prices[0];
                    hedgeUp = prices[1];
                    hedgeDown = prices[1] / 2;
                }
            }
        }

        console.log(`🎯 ПАЗАР: ${MARKET.question}`);
        console.log(`💰 Ликвидност: $${liquidity.toLocaleString()}`);
        console.log(`✅ Цени: Yes=${mainPrice}, No=${hedgeUp}`);

        if (liquidity < 5000) {
            console.log(`⚠️ Ликвидността ($${liquidity}) е под минималната ($5000)`);
            return { success: false, error: "Low liquidity" };
        }

        const result = {
            success: true,
            title: MARKET.question,
            conditionId: MARKET.conditionId,
            tokens: MARKET.tokens,
            liquidity: liquidity,
            prices: { main: mainPrice, hedgeUp: hedgeUp, hedgeDown: hedgeDown }
        };

        priceCache = result;
        cacheTimestamp = Date.now();
        return result;

    } catch (err) {
        console.error("❌ Грешка:", err.message);
        if (priceCache) return priceCache;
        return {
            success: true,
            title: MARKET.question,
            conditionId: MARKET.conditionId,
            tokens: MARKET.tokens,
            liquidity: 24000,
            prices: { main: 0.525, hedgeUp: 0.475, hedgeDown: 0.237 }
        };
    }
}

module.exports = { refreshLiquidMarkets };
