import requests
import os

# 1. Настройка на локацията (Пример: Лондон, Хийтроу)
LAT = 51.4706
LON = -0.4619

def get_professional_forecast():
    """Извлича прогноза от ECMWF модела чрез Open-Meteo"""
    url = f"https://api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LON}&daily=temperature_2m_max&models=ecmwf_ifs04&timezone=auto"
    try:
        response = requests.get(url).json()
        forecast_temp = response['daily']['temperature_2m_max'][1] # Прогноза за утре
        return forecast_temp
    except Exception as e:
        print(f"Грешка при извличане на времето: {e}")
        return None

def analyze_market(forecast_temp, market_bins):
    """Логика за анализ на залозите според стратегията"""
    results = []
    print(f"\n--- Анализ при прогнозирана макс. температура: {forecast_temp}°C ---")
    
    for bin_temp, price in market_bins.items():
        diff = abs(bin_temp - forecast_temp)
        
        # Основен хедж (съседни градуси)
        if diff <= 1:
            if price < 0.35:
                results.append(f"✅ ПРЕПОРЪКА: Купи {bin_temp}°C (Централен залог). Цена: ${price}")
        
        # Стратегия за "Дебели опашки" (Cheap Bins за 100x печалба)
        elif 2 <= diff <= 4:
            if price <= 0.05:
                potential = round(1 / price, 1)
                results.append(f"🚀 ЕКСПРЕС: Купи {bin_temp}°C (Висок риск/възнаграждение). Цена: ${price} ({potential}x потенциал)")

    return results

# ТЕСТОВИ ДАННИ (За проверка в Codespaces)
# В реална ситуация тук ще се извикват данните от Polymarket API
example_market = {
    14: 0.02,
    15: 0.10,
    16: 0.30,
    17: 0.35,
    18: 0.08,
    19: 0.01
}

if __name__ == "__main__":
    temp = get_professional_forecast()
    if temp:
        recommendations = analyze_market(temp, example_market)
        for rec in recommendations:
            print(rec)
    else:
        print("Неуспешно извличане на данни.")
