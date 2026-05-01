import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # ==================== API KEYS ====================
    POLYMARKET_API_KEY = os.getenv('POLYMARKET_API_KEY', '')
    POLYMARKET_SECRET = os.getenv('POLYMARKET_SECRET', '')
    WALLET_PRIVATE_KEY = os.getenv('WALLET_PRIVATE_KEY', '')
    WALLET_ADDRESS = os.getenv('WALLET_ADDRESS', '')
    
    OPENWEATHER_API_KEY = os.getenv('OPENWEATHER_API_KEY', '')
    WINDY_API_KEY = os.getenv('WINDY_API_KEY', '')
    
    # ==================== BOT SETTINGS ====================
    CHECK_INTERVAL_MINUTES = int(os.getenv('CHECK_INTERVAL_MINUTES', 15))
    MAX_INVESTMENT_PER_TRADE = float(os.getenv('MAX_INVESTMENT_PER_TRADE', 10))
    MIN_LIQUIDITY = float(os.getenv('MIN_LIQUIDITY', 3000))
    MAX_PRICE_SUM = float(os.getenv('MAX_PRICE_SUM', 0.96))
    
    # ==================== RISK MANAGEMENT ====================
    MAX_POSITION_SIZE = float(os.getenv('MAX_POSITION_SIZE', 50))
    DAILY_LOSS_LIMIT = float(os.getenv('DAILY_LOSS_LIMIT', 20))
    MAX_POSITIONS_PER_CITY = int(os.getenv('MAX_POSITIONS_PER_CITY', 2))
    KELLY_CRITERION_FRACTION = float(os.getenv('KELLY_CRITERION_FRACTION', 0.5))
    
    # ==================== STRATEGY SETTINGS ====================
    MIN_CONFIDENCE_SCORE = float(os.getenv('MIN_CONFIDENCE_SCORE', 0.7))
    MIN_MODEL_CONSENSUS = float(os.getenv('MIN_MODEL_CONSENSUS', 0.8))
    TEMPERATURE_RANGE = int(os.getenv('TEMPERATURE_RANGE', 1))
    ENABLE_ML_PREDICTIONS = os.getenv('ENABLE_ML_PREDICTIONS', 'false').lower() == 'true'
    
    # ==================== CITIES TO MONITOR ====================
    MONITORED_CITIES = os.getenv('MONITORED_CITIES', 'New York,Los Angeles,Chicago,London,Paris,Tokyo').split(',')
    
    # ==================== MODEL WEIGHTS ====================
    MODEL_WEIGHTS = {
        'ecmwf': 0.40,
        'gfs': 0.35,
        'icon': 0.25
    }
    
    # ==================== FLASK SETTINGS ====================
    FLASK_ENV = os.getenv('FLASK_ENV', 'development')
    PORT = int(os.getenv('PORT', 5000))
    DEBUG = FLASK_ENV == 'development'
    
    # ==================== LOGGING ====================
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
    LOG_FILE = os.getenv('LOG_FILE', 'logs/bot.log')
