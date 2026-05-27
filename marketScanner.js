cd ~/polymarket-weather-bot
cat > marketScanner.js << 'EOF'
const axios = require('axios');

let priceCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10000;
const MIN_VOLUME = 5000;

// Глобална референция за CLOB клиента (ще се подава от index.js)
let clobClientRef = null;

function setClobClient(client) {
    clobClientRef = client;
}

async function refreshLiquidMarkets() {
    if (priceCache && (Date.now() - cacheTimestamp) < CACHE_TTL) {
        console.log("📦 Връщам кеширани данни");
        return priceCache;
    }

    const url = 'https://gamma-api.polymarket.com/markets?closed=false&limit=30';
    
    try {
        console.log("🔍 Сканирам Gamma API за пазари...");
        const response = await axios.get(url, { timeout: 10000 });
        const markets = response.data;
        
        if (!markets || markets.length === 0) {
            return { success: false, error: "Няма пазари" };
        }

        // Филтрираме пазари с достатъчен обем
        let validMarkets = markets.filter(m => {
            const volume = m.volume || m.volume24hr || 0;
            return volume >= MIN_VOLUME;
        });

        if (validMarkets.length === 0) {
            console.log("⚠️ Няма пазари с достатъчен обем");
            return { success: false, error: "Няма ликвидни пазари" };
        }

        // Сортираме по обем
        validMarkets.sort((a, b) => (b.volume || 0) - (a.volume || 0));
        const best = validMarkets[0];
        const volume = best.volume || best.volume24hr || 0;

        console.log(`📊 Избран пазар: ${best.question}`);
        console.log(`💰 Обем: $${volume.toLocaleString()}`);

        // Взимаме токените чрез CLOB клиента (ако е наличен)
        let tokens = [];
        let mainPrice = 0.50, hedgeUp = 0.30, hedgeDown = 0.20;

        if (clobClientRef && best.conditionId) {
            try {
                console.log(`🔑 Взимам токени за conditionId: ${best.conditionId}`);
                const marketInfo = await clobClientRef.getClobMarketInfo(best.conditionId);
                
                if (marketInfo && marketInfo.tokens && marketInfo.tokens.length >= 2) {
                    tokens = marketInfo.tokens.map(t => t.tokenId || t);
                    console.log(`🎫 Намерени токени: ${tokens.length}`);
                }
                
                // Взимаме цените от книгата
                if (tokens.length >= 2) {
                    const book = await clobClientRef.getOrderBook(tokens[0]);
                    if (book && book.bids && book.bids.length) {
                        mainPrice = parseFloat(book.bids[0].price);
                    }
                }
            } catch (err) {
                console.log(`⚠️ Грешка при взимане на токени: ${err.message}`);
            }
        }

        // Ако нямаме токени от CLOB, ползваме fallback
        if (tokens.length === 0) {
            console.log("⚠️ Нямам токени от CLOB, използвам fallback");
            tokens = ["0x01", "0x02", "0x03"];
        }

        // Цени от outcomePrices като fallback
        if (best.outcomePrices && best.outcomePrices.length) {
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
            conditionId: best.conditionId,
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

module.exports = { refreshLiquidMarkets, setClobClient, MIN_LIQUIDITY: MIN_VOLUME };
EOF
