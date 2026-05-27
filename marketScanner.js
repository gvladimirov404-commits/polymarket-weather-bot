const axios = require('axios');

let priceCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10000;
const MIN_VOLUME = 1000;

async function refreshLiquidMarkets() {
    if (priceCache && (Date.now() - cacheTimestamp) < CACHE_TTL) {
        console.log("📦 Кеш");
        return priceCache;
    }

    const url = 'https://gamma-api.polymarket.com/markets?closed=false&limit=50';
    
    try {
        console.log("🔍 Сканиране...");
        const response = await axios.get(url, { timeout: 10000 });
        const markets = response.data;
        
        if (!markets || markets.length === 0) {
            return { success: false, error: "No markets" };
        }

        // Филтър за пазари с токени
        const valid = markets.filter(m => 
            m.clob_token_ids && m.clob_token_ids.length >= 2 && 
            (m.volume || m.volume24hr || 0) >= MIN_VOLUME
        );

        if (valid.length === 0) {
            console.log("⚠️ Няма активни пазари с токени");
            return { success: false, error: "No active markets" };
        }

        valid.sort((a, b) => (b.volume || 0) - (a.volume || 0));
        const best = valid[0];
        const volume = best.volume || best.volume24hr || 0;

        console.log(`📊 ${best.question}`);
        console.log(`💰 Обем: $${volume.toLocaleString()}`);

        // Обработка на outcomePrices (може да е стринг или масив)
        let main = 0.50, up = 0.30, down = 0.20;
        
        try {
            let outcomePrices = best.outcomePrices;
            
            // Ако е стринг, опитай да го парснеш като JSON
            if (typeof outcomePrices === 'string') {
                try {
                    outcomePrices = JSON.parse(outcomePrices);
                } catch(e) {
                    outcomePrices = [];
                }
            }
            
            // Ако не е масив, опитай да го превърнеш
            if (!Array.isArray(outcomePrices)) {
                outcomePrices = [];
            }
            
            // Филтриране на валидни цени
            const prices = outcomePrices
                .map(v => typeof v === 'string' ? parseFloat(v) : v)
                .filter(v => !isNaN(v) && v > 0 && v < 1);
            
            if (prices.length >= 2) {
                prices.sort((a, b) => b - a);
                main = prices[0];
                up = prices[1];
                down = prices.length >= 3 ? prices[2] : prices[1] * 0.5;
                console.log(`✅ Цени: Main=${main}, Up=${up}, Down=${down}`);
            } else {
                console.log("⚠️ Няма валидни цени, използвам default");
            }
        } catch(priceErr) {
            console.log("⚠️ Грешка при парсване на цените:", priceErr.message);
        }

        const result = {
            success: true,
            title: best.question,
            tokens: best.clob_token_ids.slice(0, 3),
            liquidity: volume,
            prices: { main, hedgeUp: up, hedgeDown: down }
        };

        priceCache = result;
        cacheTimestamp = Date.now();
        return result;

    } catch (err) {
        console.error("❌ Грешка:", err.message);
        if (priceCache) return priceCache;
        return { success: false, error: err.message, prices: { main: 0.50, hedgeUp: 0.30, hedgeDown: 0.20 } };
    }
}

module.exports = { refreshLiquidMarkets, MIN_LIQUIDITY: MIN_VOLUME };
