import requests
import json

# Настройка на координати (Лондон)
LAT = 51.4706
LON = -0.4619

def get_professional_forecast():
    """Извлича прогноза от ECMWF модела чрез Open-Meteo с подробна диагностика"""
    # Използваме HTTP вместо HTTPS за тест, ако сертификатите на Codespaces правят проблем
    url = f"http://api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LON}&daily=temperature_2m_max&models=ecmwf_ifs04&timezone=auto"
    
    print(f"📡 Опит за връзка с: {url}")
    
    try:
        response = requests.get(url, timeout=15)
        print(f"🌐 Статус код: {response.status_code}")
        
        if response.status_code != 200:
            print(f"⚠️ Сървърът върна грешка: {response.text}")
            return None
            
        data = response.json()
        
        if 'daily' in data and 'temperature_2m_max' in data['daily']:
            # Взимаме температурата за утре (индекс 1)
            forecast_temp = data['daily']['temperature_2m_max'][1]
            return forecast_temp
        else:
            print("❓ API-то върна отговор, но форматът е непознат.")
            print(f"Данни от API: {json.dumps(data, indent=2)}")
            return None
            
    except requests.exceptions.Timeout:
        print("⏳ Времето за изчакване изтече (Timeout). Сървърът не отговаря.")
        return None
    except Exception as e:
        print(f"❌ Критична грешка при връзката: {e}")
        return None

def analyze_market(forecast_temp, market_bins):
    """Логика за анализ на залозите"""
    results = []
    print(f"\n✅ УСПЕШНО ИЗВЛИЧАНЕ!")
    print(f"--- АНАЛИЗ ПРИ ПРОГНОЗА: {forecast_temp}°C ---")
    
    for bin_temp, price in market_bins.items():
        diff = abs(bin_temp - forecast_temp)
        
        # 1. Основен хедж (съседни градуси)
        if diff <= 1:
            if price < 0.45:
                results.append(f"🟢 ЦЕНТРАЛЕН: {bin_temp}°C | Цена: ${price}")
        
        # 2. Стратегия "Cheap Bins" (100x потенциал)
        elif 2 <= diff <= 4:
            if price <= 0.05:
                potential = round(1 / price, 1)
                results.append(f"🔥 ЕКСПРЕС: {bin_temp}°C | Цена: ${price} ({potential}x)")

    return results

# ТЕСТОВИ ДАННИ
example_market = {14: 0.02, 15: 0.35, 16: 0.30, 17: 0.10, 18: 0.01}

if __name__ == "__main__":
    temp = get_professional_forecast()
    
    if temp is not None:
        recommendations = analyze_market(temp, example_market)
        if not recommendations:
            print("Няма подходящи залози в момента.")
        for rec in recommendations:
            print(rec)
    else:
        print("\n🛑 Ботът не успя да зареди данни за времето.")
