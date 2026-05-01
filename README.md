# Polymarket Weather Bot 🌤️

Автоматизиран бот за търговия на weather markets в Polymarket с оптимизирана стратегия.

## 🎯 Стратегия

Ботът използва мулти-модел прогнози за времето (ECMWF, GFS, ICON) заедно с:
- **Machine Learning** predictions
- **Kelly Criterion** за оптимален position sizing
- **Portfolio diversification** management
- **Advanced risk management**
- **Liquidity optimization**

### Ключови принципи:

✅ **Консенсус между модели**: Трябва да има съгласие между 3+ метеорологични модела  
✅ **Ниска сума на цените**: Сумата от цените < 96¢  
✅ **Висока ликвидност**: Минимум $3000  
✅ **Управление на риска**: Дневни лимити и Kelly Criterion  
✅ **ML predictions**: Optional machine learning за по-добра точност

## 📋 Изисквания

- Python 3.11+
- Polymarket API keys
- OpenWeatherMap API key
- Windy API key (optional, but recommended)
- Wallet с USDC на Polygon мрежата

## 🚀 Инсталация

### 1. Клониране

```bash
git clone https://github.com/YOUR_USERNAME/polymarket-weather-bot.git
cd polymarket-weather-bot
```

### 2. Инсталиране на зависимости

```bash
pip install -r requirements.txt
```

### 3. Конфигурация

```bash
cp .env.example .env
```
Попълнете вашите API keys в `.env`:

```env
POLYMARKET_API_KEY=your_api_key
POLYMARKET_SECRET=your_secret
WALLET_PRIVATE_KEY=your_private_key
WALLET_ADDRESS=your_wallet_address
OPENWEATHER_API_KEY=your_openweather_key
WINDY_API_KEY=your_windy_key
```

### 4. Тестване

```bash
python test_bot.py
```

### 5. Стартиране

```bash
python main.py
```

## 🌐 API Endpoints

- `GET /` - Home page
- `GET /health` - Health check
- `GET /status` - Detailed bot status
- `POST /run` - Manually trigger bot
- `GET /markets` - List available markets
- `GET /stats` - Trading statistics
- `GET /balance` - Wallet balance

## 📊 Конфигурация

В `config.py` или `.env`:

| Параметър | По подразбиране | Описание |
|-----------|----------------|----------|
| `CHECK_INTERVAL_MINUTES` | 15 | Колко често да проверява |
| `MAX_INVESTMENT_PER_TRADE` | 10 | Максимум на сделка ($) |
| `MIN_LIQUIDITY` | 3000 | Минимална ликвидност ($) |
| `MAX_PRICE_SUM` | 0.96 | Максимум сума на цените |
| `MAX_POSITION_SIZE` | 50 | Максимум обща експозиция ($) |
| `DAILY_LOSS_LIMIT` | 20 | Дневен лимит на загуби ($) |
| `KELLY_CRITERION_FRACTION` | 0.5 | Fraction of Kelly (0-1) |
| `MIN_CONFIDENCE_SCORE` | 0.7 | Минимален consensus score |
| `ENABLE_ML_PREDICTIONS` | false | Enable ML predictions |

## 🚀 Деплой на Render
### 1. Създайте акаунт

Отидете на [Render.com](https://render.com) и се регистрирайте с GitHub.

### 2. Създайте Web Service

- Dashboard → New → Web Service
- Изберете вашия репозиторий

### 3. Конфигурация
