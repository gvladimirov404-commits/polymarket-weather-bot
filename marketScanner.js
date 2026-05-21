import axios from 'axios';

export async function refreshLiquidMarkets() {
    const url = 'https://gamma-api.polymarket.com/markets?closed=false&order=liquidity_num:desc&limit=10';
    try {
        const response = await axios.get(url);
        const markets = response.data;
        
        // Филтрираме за метеорологични пазари
        const weatherRelated = markets.filter(m => m.question && (
            m.question.toLowerCase().includes('temperature') || 
            m.question.toLowerCase().includes('weather') || 
            m.question.toLowerCase().includes('temp')
        ));

        if (weatherRelated.length > 0) {
            // Взимаме първия най-ликвиден пазар
            const mainMarket = weatherRelated[0];
            
            // Polymarket пазарите обикновено имат масив от токени (напр. [Yes, No] или списък с температури)
            if (mainMarket.clob_token_ids && mainMarket.clob_token_ids.length >= 2) {
                return {
                    success: true,
                    title: mainMarket.title,
                    tokens: mainMarket.clob_token_ids, // Масив с всички Token ID-та на пазара
                    liquidity: mainMarket.liquidity_num
                };
            }
        }
    } catch (err) { 
        console.error("Грешка при сканиране на Polymarket API:", err.message); 
    }
    return { success: false };
}
