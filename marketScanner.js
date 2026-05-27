const axios = require('axios');

let priceCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10000;

async function refreshLiquidMarkets() {
    if (priceCache && (Date.now() - cacheTimestamp) < CACHE_TTL) {
        console.log("📦 Кеш");
        return priceCache;
    }

    const url = 'https://gamma-api.polymarket.com/markets?closed=false&limit=30';
    
    try {
        console.log("🔍 Сканирам Gamma API...");
        const response = await axios.get(url, { timeout: 10000 });
        let markets = response.data;
        
        if (!markets || markets.length === 0) {
            return { success: false, error: "Няма пазари" };
        }

        // Филтрираме пазари с достатъчен обем
        markets = markets.filter(m => {
            const volume = m.volume || m.volume24hr || 0;
            return volume > 10000;
        });

        if (markets.length === 0) {
            return { success: false, error: "Няма ликвидни пазари" };
        }

        markets.sort((a, b) => (b.volume || 0) - (a.volume || 0));
        const best = markets[0];
        const volume = best.volume || best.volume24hr || 0;

        console.log(`📊 ${best.question}`);
        console.log(`💰 Обем: $${volume.toLocaleString()}`);

        // Вземаме токени от Gamma API
        let tokens = [];
        
        if (best.clobTokenIds && Array.isArray(best.clobTokenIds)) {
            tokens = best.clobTokenIds;
            console.log(`🎫 Токени от Gamma: ${tokens.length}`);
        } else if (best.clob_token_ids && Array.isArray(best.clob_token_ids)) {
            tokens = best.clob_token_ids;
            console.log(`🎫 Токени от Gamma (alt): ${tokens.length}`);
        }

        // Цени от outcomePrices
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

        console.log(`✅ Цени: ${mainPrice.toFixed(3)} / ${hedgeUp.toFixed(3)} / ${hedgeDown.toFixed(3)}`);

        if (tokens.length === 0) {
            console.log("❌ Няма токени за този пазар");
            return { success: false, error: "Няма токени" };
        }

        const result = {
            success: true,
            title: best.question,
            conditionId: best.conditionId,
            tokens: tokens.slice(0, 3),
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
