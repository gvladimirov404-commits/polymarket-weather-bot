import axios from 'axios';

export async function refreshLiquidMarkets() {
  const url = 'https://gamma-api.polymarket.com/markets?closed=false&order=liquidity_num:desc&limit=5';
  try {
    const response = await axios.get(url);
    const markets = response.data;
    const weatherRelated = markets.filter(m => m.question && (m.question.includes('temperature') || m.question.includes('weather') || m.question.includes('temp')));
    if (weatherRelated.length > 0) {
      return weatherRelated.map(m => ({
        city: m.title || m.question,
        tokenID: m.clob_token_ids?.[0],
        liquidity: m.liquidity_num,
        volume: m.volume_num
      }));
    }
  } catch (err) { console.error(err); }
  return [];
}
