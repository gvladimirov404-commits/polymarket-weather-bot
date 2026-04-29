import requests
import json

# Настройки за локация (Лондон)
LAT = 51.4706
LON = -0.4619

def get_professional_forecast():
    """Извлича прогноза от ECMWF модела чрез Open-Meteo"""
    # Използваме директен URL за проверка
    url = f"https://api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LON}&daily=temperature_2m_max&models=ecmwf_ifs04&timezone=auto"
    
    print(f"📡 Опит за връзка с метеорологичния модел...")
    
    try:
        # Използваме легитимен User-Agent, за да не ни блокират
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(url, headers=headers, timeout=15)
        
        if response.status_code == 200:
            data = response.json()
            forecast_temp = data['daily']['temperature_2m_max'][1]
            return forecast_temp
        else:
            print(f"❌ Сървърът върна статус: {response.status_code}")
            return None
            
    except Exception as e:
        print(f"❌ Грешка при мрежовата заявка: {e}")
        return None

def analyze_market(forecast_temp, market_bins):
    """Логика за анализ на залозите според стратегията"""
    print(f"\n✅ ДАННИТЕ СА ЗАРЕДЕНИ УСПЕШНО!")
    print(f"--- ПРОГНОЗА ЗА УТРЕ: {forecast_temp}°C ---")
    print("-" * 40)
    
    recommendations = []
    for bin_temp, price in market_bins.items():
        diff = abs(bin_temp - forecast_temp)
        
        # 1. Централен залог (Hedge)
        if diff <= 1 and price < 0.45:
            recommendations.append(f"🟢 ЦЕНТРАЛЕН ЗАЛОГ: {bin_temp}°C | Цена: ${price}")
        
        # 2. Експрес (Cheap Bins за 100x)
        elif 2 <= diff <= 4 and price <= 0.05:
            potential = round(1 / price, 1)
            recommendations.append(f"🔥 ЕКСПРЕС (Висок профит): {bin_temp}°C | Цена: ${price} ({potential}x)")

    return recommendations

# ТЕСТОВИ ДАННИ (Заместват реалния пазар за момента)
example_market = {
    13: 0.02, 
    14: 0.15, 
    15: 0.38, 
    16: 0.28, 
    17: 0.09, 
    18: 0.01
}

if __name__ == "__main__":
    temp = get_professional_forecast()
    
    if temp is not None:
        recs = analyze_market(temp, example_market)
        if recs:
            for r in recs:
                print(r)
        else:
            print("Няма изгодни позиции в момента.")
    else:
        print("\n🛑 ВНИМАНИЕ: Проблем с връзката към API-то.")
        print("Ако си в Codespaces, увери се, че терминалът има достъп до интернет.")
