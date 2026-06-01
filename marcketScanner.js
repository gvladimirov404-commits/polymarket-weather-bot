const axios = require('axios');

let priceCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10000;
const MIN_LIQUIDITY = 5000;

async function refreshLiquidMarkets() {
    if (priceCache && (Date.now() - cacheTimestamp) < CACHE_TTL) return priceCache;

    const url = 'https://gamma-api.polymarket.com/markets?closed=false&limit=50';
    try {
        console.log("🔍 Сканирам всички пазари...");
        const response = await axios.get(url, { timeout: 10000 });
        let markets = response.data;
        if (!markets || markets.length === 0) return { success: false, error: "Няма пазари" };

        // Първо търсим метео
        const weatherKeywords = ['temperature', 'temp', 'weather', 'celsius', 'forecast', 'highest', 'lowest', 'rain', 'snow'];
        let weatherMarkets = markets.filter(m => {
            const q = (m.question || "").toLowerCase();
            return weatherKeywords.some(kw => q.includes(kw));
        });

        let selectedMarket = null;
        if (weatherMarkets.length > 0) {
            weatherMarkets.sort((a, b) => (b.volume || 0) - (a.volume || 0));
            selectedMarket = weatherMarkets[0];
            console.log(`🌤️ Избран метео пазар: ${selectedMarket.question}`);
        } else {
            markets.sort((a, b) => (b.volume || 0) - (a.volume || 0));
            selectedMarket = markets[0];
            console.log(`📊 Няма метео пазари. Избран най-ликвидният: ${selectedMarket.question}`);
        }

        const volume = selectedMarket.volume || selectedMarket.volume24hr || 0;
        if (volume < MIN_LIQUIDITY) return { success: false, error: "Low liquidity" };

        let mainPrice = 0.50, hedgeUp = 0.30, hedgeDown = 0.20;
        if (selectedMarket.outcomePrices) {
            let prices = [];
            if (Array.isArray(selectedMarket.outcomePrices)) {
                prices = selectedMarket.outcomePrices.map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0);
            } else if (typeof selectedMarket.outcomePrices === 'string') {
                try {
                    const parsed = JSON.parse(selectedMarket.outcomePrices);
                    if (Array.isArray(parsed)) prices = parsed.map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0);
                } catch(e) {}
            }
            if (prices.length >= 2) {
                prices.sort((a, b) => b - a);
                mainPrice = prices[0];
                hedgeUp = prices[1];
                hedgeDown = prices.length >= 3 ? prices[2] : prices[1] * 0.5;
            }
        }

        let tokens = [];
        if (selectedMarket.clobTokenIds) {
            if (Array.isArray(selectedMarket.clobTokenIds)) tokens = selectedMarket.clobTokenIds;
            else if (typeof selectedMarket.clobTokenIds === 'string') {
                try { tokens = JSON.parse(selectedMarket.clobTokenIds); } catch(e) {}
            }
        }
        if (tokens.length === 0) return { success: false, error: "Няма токени" };

        console.log(`💰 Обем: $${volume.toLocaleString()}`);
        console.log(`✅ Цени: Yes=${mainPrice.toFixed(3)}, No=${hedgeUp.toFixed(3)}`);

        const result = {
            success: true,
            title: selectedMarket.question,
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
