import requests
import os

# 1. Настройка на локацията (Пример: Лондон, Хийтроу)
LAT = 51.4706
LON = -0.4619

def get_professional_forecast():
    """Извлича прогноза от ECMWF модела чрез Open-Meteo с подробна диагностика"""
    url = f"https://api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LON}&daily=temperature_2m_max&models=ecmwf_ifs04&timezone=auto"
    
    print(f"Изпращане на заявка към: {url}...")
    
    try:
        response = requests.get(url, timeout=10)
        print(f"Статус код на отговора: {response.status_code}")
        
        if response.status_code != 200:
            print(f"Грешка от сървъра: {response.text}")
            return None
            
        data = response.json()
        
        # Проверка дали в отговора има нужните данни
        if 'daily' in data and 'temperature_2m_max' in data['daily']:
            forecast_temp = data['daily']['temperature_2m_max'][1] # Прогноза за утре
            return forecast_temp
        else:
            print("Липсват данни за температурата в отговора на API.")
            return None
            
    except Exception as e:
        print(f"Критична грешка при връзката: {e}")
        return None

def analyze_market(forecast_temp, market_bins):
    """Логика за анализ на залозите според стратегията от видеото"""
    results = []
    print(f"\n--- АНАЛИЗ ПРИ ПРОГНОЗА: {forecast_temp}°C ---")
    
    for bin_temp, price in market_bins.items():
        diff = abs(bin_temp - forecast_temp)
        
        # 1. Основен хедж (съседни градуси) - сигурност
        if diff <= 1:
            if price < 0.40:
                results.append(f"✅ ЦЕНТРАЛЕН: Купи {bin_temp}°C | Цена: ${price} | Статус: Подценено")
        
        # 2. Стратегия "Cheap Bins" - голямата печалба (100x потенциал)
        elif 2 <= diff <= 4:
            if price <= 0.05:
                potential = round(1 / price, 1)
                results.append(f"🚀 ЕКСПРЕС (100x): Купи {bin_temp}°C | Цена: ${price} | Потенциал: {potential}x")

    return results

# ТЕСТОВИ ДАННИ ЗА ПАЗАРА (Ще ги заменим с API по-късно)
example_market = {
    12: 0.01,
    13: 0.04,
    14: 0.25,
    15: 0.38,
    16: 0.20,
    17: 0.09,
    18: 0.02
}

if __name__ == "__main__":
    temp = get_professional_forecast()
    
    if temp is not None:
        recommendations = analyze_market(temp, example_market)
        if not recommendations:
            print("Няма изгодни залози в момента според зададените критерии.")
        for rec in recommendations:
            print(rec)
    else:
        print("\n❌ ПРОБЛЕМ: Ботът не успя да получи данни за времето.")
        print("Провери дали VPN-ът не блокира заявката или опитай пак след малко.")
