let activePositions = new Map();

async function loadOurTrades(clobClient) {
    if (!clobClient) return false;
    try {
        let trades = [];
        try {
            const response = await clobClient.getBuilderTrades();
            if (response && Array.isArray(response)) trades = response;
            else if (response && response.data && Array.isArray(response.data)) trades = response.data;
        } catch (err) {
            console.log("ℹ️ getBuilderTrades() не е наличен или няма сделки:", err.message);
            return true;
        }
        if (trades.length === 0) return true;
        const tokenMap = new Map();
        for (const trade of trades) {
            if (trade.side !== 'BUY') continue;
            const tokenId = trade.tokenId || trade.assetId;
            const price = parseFloat(trade.price);
            const size = parseFloat(trade.size);
            if (!tokenId || isNaN(price) || isNaN(size)) continue;
            if (tokenMap.has(tokenId)) {
                const cur = tokenMap.get(tokenId);
                const totalCost = cur.avgPrice * cur.shares + price * size;
                const totalShares = cur.shares + size;
                tokenMap.set(tokenId, { avgPrice: totalCost / totalShares, shares: totalShares, conditionId: trade.conditionId });
            } else {
                tokenMap.set(tokenId, { avgPrice: price, shares: size, conditionId: trade.conditionId });
            }
        }
        activePositions.clear();
        for (const [tokenId, data] of tokenMap.entries()) activePositions.set(tokenId, data);
        return true;
    } catch (err) {
        console.error("❌ Грешка при зареждане на позиции:", err.message);
        return false;
    }
}

async function checkAndClosePositions(clobClient, marketPrices, sendToTelegram) {
    if (!clobClient) return;
    if (activePositions.size === 0) return;
    for (const [tokenId, pos] of activePositions.entries()) {
        const currentPrice = marketPrices[tokenId];
        if (!currentPrice) continue;
        const pnl = (currentPrice - pos.avgPrice) / pos.avgPrice;
        if (pnl >= 0.15) {
            console.log(`🎉 TP! ${tokenId} +${(pnl*100).toFixed(1)}%`);
            try {
                await clobClient.createOrder({ tokenID: tokenId, side: 'SELL', price: currentPrice, size: pos.shares });
                activePositions.delete(tokenId);
                if (sendToTelegram) sendToTelegram(`✅ Тейк-профит: +${(pnl*100).toFixed(1)}%`);
            } catch (e) { console.error("Грешка при TP:", e.message); }
        } else if (pnl <= -0.08) {
            console.log(`🛑 SL! ${tokenId} ${(pnl*100).toFixed(1)}%`);
            try {
                await clobClient.createOrder({ tokenID: tokenId, side: 'SELL', price: currentPrice, size: pos.shares });
                activePositions.delete(tokenId);
                if (sendToTelegram) sendToTelegram(`🛑 Стоп-лос: ${(pnl*100).toFixed(1)}%`);
            } catch (e) { console.error("Грешка при SL:", e.message); }
        }
    }
}

module.exports = { loadOurTrades, checkAndClosePositions };
