cd ~/polymarket-weather-bot
cat > marketScanner.js << 'EOF'
const axios = require('axios');

let priceCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10000;

async function refreshLiquidMarkets() {
    if (priceCache && (Date.now() - cacheTimestamp) < CACHE_TTL) {
        return priceCache;
    }

    const url = 'https://gamma-api.polymarket.com/markets?closed=false&limit=30';
    
    try {
        console.log("🔍 Сканирам...");
        const response = await axios.get(url, { timeout: 10000 });
        const markets = response.data;
        
        if (!markets || markets.length === 0) {
            return { success: false, error: "Няма пазари" };
        }

        // Търсим първия пазар с clobTokenIds
        let selected = null;
        let tokens = [];
        
        for (const m of markets) {
            if (m.clobTokenIds && Array.isArray(m.clobTokenIds) && m.clobTokenIds.length >= 2) {
                tokens = m.clobTokenIds;
                selected = m;
                break;
            }
            if (m.clob_token_ids && Array.isArray(m.clob_token_ids) && m.clob_token_ids.length >= 2) {
                tokens = m.clob_token_ids;
                selected = m;
                break;
            }
        }

        if (!selected) {
            console.log("⚠️ Няма пазар с токени");
            return { success: false, error: "Няма токени" };
        }

        const volume = selected.volume || selected.volume24hr || 0;
        console.log(`📊 ${selected.question}`);
        console.log(`💰 Обем: $${volume.toLocaleString()}`);
        console.log(`🎫 Токени: ${tokens.length}`);

        // Цени
        let mainPrice = 0.50, hedgeUp = 0.30, hedgeDown = 0.20;
        if (selected.outcomePrices) {
            let prices = [];
            if (Array.isArray(selected.outcomePrices)) {
                prices = selected.outcomePrices.map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0);
            } else if (typeof selected.outcomePrices === 'string') {
                try {
                    const parsed = JSON.parse(selected.outcomePrices);
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

        const result = {
            success: true,
            title: selected.question,
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
EOF
