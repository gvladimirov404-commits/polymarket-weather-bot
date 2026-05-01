import requests
from datetime import datetime, timedelta
from config import Config
import logging

logger = logging.getLogger(__name__)

class WeatherAPI:
    """Weather data API client"""
    
    def __init__(self):
        self.openweather_key = Config.OPENWEATHER_API_KEY
        self.windy_key = Config.WINDY_API_KEY
        self.base_url = 'https://api.openweathermap.org/data/2.5'
    
    def get_city_coordinates(self, city_name):
        """Get coordinates for a city"""
        try:
            response = requests.get(
                f'{self.base_url}/geo/1.0/direct',
                params={
                    'q': city_name,
                    'limit': 1,
                    'appid': self.openweather_key
                },
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if data:
                    return {
                        'lat': data[0]['lat'],
                        'lon': data[0]['lon'],
                        'name': data[0]['name']
                    }
            return None
            
        except Exception as e:
            logger.error(f"Error getting coordinates for {city_name}: {e}")
            return None
    
    def get_forecast_openweather(self, lat, lon):
        """Get weather forecast from OpenWeatherMap"""
        try:
            response = requests.get(
                f'{self.base_url}/forecast',
                params={
                    'lat': lat,
                    'lon': lon,                    'appid': self.openweather_key,
                    'units': 'metric'
                },
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                forecasts = []
                
                for item in data['list'][:8]:
                    forecasts.append({
                        'datetime': item['dt_txt'],
                        'temp': item['main']['temp'],
                        'temp_max': item['main']['temp_max'],
                        'temp_min': item['main']['temp_min'],
                        'feels_like': item['main']['feels_like'],
                        'humidity': item['main']['humidity']
                    })
                
                return forecasts
            return []
            
        except Exception as e:
            logger.error(f"Error getting forecast: {e}")
            return []
    
    def get_windy_models(self, lat, lon):
        """Get forecasts from different models via Windy API"""
        try:
            models = ['ecmwf', 'gfs', 'icon']
            forecasts = {}
            
            for model in models:
                response = requests.post(
                    'https://api.windy.com/api/point-forecast/v2',
                    params={'lat': lat, 'lon': lon},
                    json={
                        'model': model,
                        'fields': ['temperature2m']
                    },
                    headers={
                        'Content-Type': 'application/json',
                        'apikey': self.windy_key
                    },
                    timeout=10
                )
                
                if response.status_code == 200:
                    data = response.json()                    if 'data' in data and 'temperature2m' in data['data']:
                        forecasts[model] = data['data']['temperature2m']
            
            return forecasts
            
        except Exception as e:
            logger.error(f"Error getting Windy data: {e}")
            return {}
    
    def get_temperature_consensus(self, city_name):
        """
        Get temperature consensus from multiple models
        Returns weighted average based on model accuracy
        """
        coords = self.get_city_coordinates(city_name)
        if not coords:
            return None
        
        # Get forecasts from different sources
        openweather = self.get_forecast_openweather(coords['lat'], coords['lon'])
        windy_models = self.get_windy_models(coords['lat'], coords['lon'])
        
        if not windy_models:
            logger.warning(f"No Windy model data for {city_name}")
            return None
        
        # Calculate weighted average
        all_temps = []
        weights = Config.MODEL_WEIGHTS
        
        for model, temps in windy_models.items():
            if model in weights and temps:
                weight = weights[model]
                avg_temp = sum(temps) / len(temps)
                all_temps.append((avg_temp, weight))
        
        if not all_temps:
            return None
        
        # Weighted average
        weighted_sum = sum(temp * weight for temp, weight in all_temps)
        total_weight = sum(weight for _, weight in all_temps)
        weighted_avg = weighted_sum / total_weight if total_weight > 0 else 0
        
        # Calculate consensus score
        temps_only = [temp for temp, _ in all_temps]
        temp_range = max(temps_only) - min(temps_only)
        consensus_score = max(0, 1 - (temp_range / 10))  # Higher score = better consensus
        
        # Get all temps for range        all_temp_values = []
        for temps in windy_models.values():
            if temps:
                all_temp_values.extend(temps)
        
        return {
            'city': city_name,
            'coords': coords,
            'predicted_temp': round(weighted_avg),
            'weighted_avg': weighted_avg,
            'min_temp': round(min(all_temp_values)) if all_temp_values else 0,
            'max_temp': round(max(all_temp_values)) if all_temp_values else 0,
            'consensus_score': consensus_score,
            'confidence': 'high' if consensus_score >= 0.8 else 'medium' if consensus_score >= 0.6 else 'low',
            'model_temps': {model: sum(temps)/len(temps) for model, temps in windy_models.items() if temps}
        }
    
    def get_historical_temp(self, city_name, days_ago=1):
        """Get historical temperature for comparison"""
        try:
            coords = self.get_city_coordinates(city_name)
            if not coords:
                return None
            
            date = datetime.now() - timedelta(days=days_ago)
            timestamp = int(date.timestamp())
            
            response = requests.get(
                'https://api.openweathermap.org/data/2.5/onecall/timemachine',
                params={
                    'lat': coords['lat'],
                    'lon': coords['lon'],
                    'dt': timestamp,
                    'appid': self.openweather_key,
                    'units': 'metric'
                },
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                return data['data'][0]['temp']
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting historical temp: {e}")
            return None
    
    def get_seasonal_adjustment(self, city_name):        """Get seasonal temperature adjustment factor"""
        try:
            # Get historical data for this date
            historical = self.get_historical_temp(city_name, days_ago=365)
            current_forecast = self.get_temperature_consensus(city_name)
            
            if historical and current_forecast:
                # Calculate deviation from last year
                deviation = current_forecast['predicted_temp'] - historical
                return {
                    'historical_temp': historical,
                    'deviation': deviation,
                    'trend': 'warming' if deviation > 0 else 'cooling' if deviation < 0 else 'stable'
                }
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting seasonal adjustment: {e}")
            return None
