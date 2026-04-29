import requests

LAT, LON = 51.4706, -0.4619

def get_professional_forecast():
    url = f"https://api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LON}&daily=temperature_2m_max&models=best_match&timezone=auto"
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        data = requests.get(url, headers=headers, timeout=20).json()
        return data['daily']['temperature_2m_max'][1]
    except: return None

def get_real_polymarket_prices():
    """Извлича реални цени от Polymarket за пазара на температурите"""
    # Търсим пазари с ключова дума "London Weather"
    url = "https://gamma-api.polymarket.com/events?active=True&closed=False&limit=10&query=London%20Weather"
    try:
        data = requests.get(url).json()
        prices = {}
        # Логика за извличане на цените от първия намерен пазар
        if data:
            market = data[0]['markets'][0] # Взимаме първия наличен пазар
            for outcome, price in zip(market['outcomes'], market['outcomePrices']):
                # Опитваме да извлечем числото от името (напр. "18°C or above" -> 18)
                try:
                    temp_val = int(''.join(filter(str.isdigit, outcome)))
                    prices[temp_val] = float(price)
                except: continue
        return prices
    except:
        return None

def run_analysis(forecast_temp, real_prices):
    print(f"\n✅ РЕАЛЕН АНАЛИЗ (Polymarket)")
    print(f"--- ПРОГНОЗА: {forecast_temp}°C ---")
    
    if not real_prices:
        print("Не бяха намерени активни реални пазари. Използвам примерни данни за демонстрация.")
        real_prices = {20: 0.05, 21: 0.30, 22: 0.40, 23: 0.10}

    for temp, price in real_prices.items():
        diff = abs(temp - forecast_temp)
        if diff <= 1 and price < 0.45:
            print(f"🟢 ЦЕНТРАЛЕН: {temp}°C | Реална цена: ${price}")
        elif 2 <= diff <= 4 and price <= 0.05:
            print(f"🔥 ЕКСПРЕС: {temp}°C | Реална цена: ${price} ({round(1/price)}x)")

if __name__ == "__main__":
    t = get_professional_forecast()
    p = get_real_polymarket_prices()
    if t: run_analysis(t, p)
