import axios from 'axios';

export async function refreshLiquidMarkets() {
    const url = 'https://gamma-api.polymarket.com/markets?closed=false&order=liquidity_num:desc&limit=10';
    try {
        const response = await axios.get(url);
        const markets = response.data;
        
        // Автоматично филтриране за активни метеорологични пазари
        const weatherRelated = markets.filter(m => m.question && (
            m.question.toLowerCase().includes('temperature') || 
            m.question.toLowerCase().includes('weather') || 
            m.question.toLowerCase().includes('temp')
        ));

        if (weatherRelated.length > 0) {
            const mainMarket = weatherRelated[0];
            
            // Проверка за наличие на токени
            if (mainMarket.clob_token_ids && mainMarket.clob_token_ids.length >= 2) {
                // Извличаме живите цени от API-то. Ако липсват, залагаме сигурни начални стойности
                const prices = mainMarket.outcomePrices ? mainMarket.outcomePrices.map(p => parseFloat(p)) : [0.70, 0.05, 0.05];

                return {
                    success: true,
                    title: mainMarket.title,
                    tokens: mainMarket.clob_token_ids,
                    prices: {
                        main: prices[0] || 0.70,
                        hedgeUp: prices[1] || 0.05,
                        hedgeDown: prices[2] || 0.05
                    },
                    liquidity: mainMarket.liquidity_num
                };
            }
        }
    } catch (err) { 
        console.error("Грешка при сканиране на Polymarket API цени:", err.message); 
    }
    return { success: false };
}
