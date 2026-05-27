const axios = require('axios');

let priceCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10000;
const MIN_VOLUME = 5000; // Минимален обем за търговия

async function refreshLiquidMarkets() {
    if (priceCache && (Date.now() - cacheTimestamp) < CACHE_TTL) {
        console.log("📦 Връщам кеширани данни");
        return priceCache;
    }

    const url = 'https://gamma-api.polymarket.com/markets?closed=false&limit=50';
    
    try {
        console.log("🔍 Сканирам Polymarket за активни пазари...");
        const response = await axios.get(url, { timeout: 10000 });
        const markets = response.data;
        
        if (!markets || markets.length === 0) {
            return { success: false, error: "Няма намерени пазари" };
        }

        // Филтриране на пазари с токени (clobTokenIds) и достатъчен обем
        const validMarkets = markets.filter(m => {
            const tokens = m.clobTokenIds || m.clob_token_ids;
            const volume = m.volume || m.volume24hr || 0;
            return tokens && Array.isArray(tokens) && tokens.length >= 2 && volume >= MIN_VOLUME;
        });

        if (validMarkets.length === 0) {
            console.log("⚠️ Няма активни пазари с достатъчен обем");
            return { success: false, error: "Няма ликвидни пазари" };
        }

        // Сортиране по обем (най-ликвидни отгоре)
        validMarkets.sort((a, b) => (b.volume || 0) - (a.volume || 0));
        const best = validMarkets[0];
        const volume = best.volume || best.volume24hr || 0;
        const tokens = best.clobTokenIds || best.clob_token_ids;

        console.log(`📊 Избран пазар: ${best.question}`);
        console.log(`💰 Обем: $${volume.toLocaleString()}`);
        console.log(`🎫 Брой токени: ${tokens.length}`);

        // Обработка на цените (outcomePrices)
        let mainPrice = 0.50, hedgeUp = 0.30, hedgeDown = 0.20;
        
        if (best.outcomePrices) {
            let prices = [];
            if (Array.isArray(best.outcomePrices)) {
                prices = best.outcomePrices.map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0 && v < 1);
            } else if (typeof best.outcomePrices === 'string') {
                try {
                    const parsed = JSON.parse(best.outcomePrices);
                    if (Array.isArray(parsed)) {
                        prices = parsed.map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0 && v < 1);
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
            tokens: tokens.slice(0, 3),
            liquidity: volume,
            prices: { main: mainPrice, hedgeUp, hedgeDown }
        };

        priceCache = result;
        cacheTimestamp = Date.now();
        return result;

    } catch (error) {
        console.error("❌ Грешка при сканиране:", error.message);
        if (priceCache) return priceCache;
        return { success: false, error: error.message };
    }
}

module.exports = { refreshLiquidMarkets, MIN_LIQUIDITY: MIN_VOLUME };
