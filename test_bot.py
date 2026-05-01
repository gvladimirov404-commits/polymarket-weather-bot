#!/usr/bin/env python3
"""
Test suite for Polymarket Weather Bot
"""

from src.weather_api import WeatherAPI
from src.polymarket_client import PolymarketClient
from src.strategy import WeatherStrategy
from src.risk_manager import RiskManager
from config import Config
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_weather_api():
    """Test weather API integration"""
    print("\n️  Testing Weather API...")
    
    weather = WeatherAPI()
    
    # Test coordinates
    coords = weather.get_city_coordinates('New York')
    if coords:
        print(f"✅ Coordinates: {coords}")
    else:
        print("❌ Failed to get coordinates")
        return False
    
    # Test forecast
    forecast = weather.get_temperature_consensus('New York')
    if forecast:
        print(f"✅ Forecast: {forecast['predicted_temp']}°C")
        print(f"   Consensus: {forecast['consensus_score']:.2f}")
        print(f"   Confidence: {forecast['confidence']}")
    else:
        print("❌ Failed to get forecast")
        return False
    
    return True

def test_polymarket():
    """Test Polymarket API connection"""
    print("\n📊 Testing Polymarket API...")
    
    client = PolymarketClient()
    
    # Test markets
    markets = client.get_weather_markets()
    print(f"✅ Found {len(markets)} weather markets")    
    if markets:
        print(f"   First market: {markets[0].get('title', 'N/A')[:50]}...")
    
    # Test balance
    balance = client.get_balance()
    print(f"✅ Wallet balance: ${balance:.2f} USDC")
    
    return True

def test_strategy():
    """Test trading strategy"""
    print("\n🎯 Testing Strategy...")
    
    strategy = WeatherStrategy()
    
    # Get markets
    markets = strategy.client.get_weather_markets()
    
    if not markets:
        print("❌ No markets available")
        return False
    
    print(f"Analyzing {len(markets)} markets...")
    
    opportunities = 0
    
    for market in markets[:5]:  # Test first 5 markets
        should_trade, reason, confidence = strategy.should_trade(market)
        
        if should_trade:
            opportunities += 1
            print(f"✅ Opportunity: {reason}")
        else:
            print(f"❌ {market.get('title', 'Unknown')[:40]}... - {reason}")
    
    print(f"\nFound {opportunities} trading opportunities")
    return True

def test_risk_manager():
    """Test risk management"""
    print("\n🛡️  Testing Risk Manager...")
    
    risk_manager = RiskManager()
    
    # Test can_trade
    can_trade, reason = risk_manager.can_trade('New York', 20, 10)
    print(f"✅ Can trade: {can_trade} - {reason}")
    
    # Test recording trade    risk_manager.record_trade('New York', 20, 10)
    print("✅ Trade recorded")
    
    # Test stats
    stats = risk_manager.get_daily_stats()
    print(f"✅ Stats: {stats}")
    
    return True

def test_configuration():
    """Test configuration"""
    print("\n⚙️  Testing Configuration...")
    
    print(f"Check interval: {Config.CHECK_INTERVAL_MINUTES} minutes")
    print(f"Max investment: ${Config.MAX_INVESTMENT_PER_TRADE}")
    print(f"Min liquidity: ${Config.MIN_LIQUIDITY}")
    print(f"Max price sum: {Config.MAX_PRICE_SUM}")
    print(f"ML enabled: {Config.ENABLE_ML_PREDICTIONS}")
    print(f"Monitored cities: {', '.join(Config.MONITORED_CITIES)}")
    
    return True

def run_all_tests():
    """Run all tests"""
    print("=" * 60)
    print("🧪 POLYMARKET WEATHER BOT - TEST SUITE")
    print("=" * 60)
    
    tests = [
        ("Configuration", test_configuration),
        ("Weather API", test_weather_api),
        ("Polymarket API", test_polymarket),
        ("Risk Manager", test_risk_manager),
        ("Strategy", test_strategy)
    ]
    
    results = []
    
    for name, test_func in tests:
        try:
            result = test_func()
            results.append((name, result))
        except Exception as e:
            logger.error(f"Test {name} failed with error: {e}")
            results.append((name, False))
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 TEST SUMMARY")
    print("=" * 60)    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {name}")
    
    print("=" * 60)
    print(f"Total: {passed}/{total} tests passed")
    print("=" * 60)
    
    return passed == total

if __name__ == '__main__':
    success = run_all_tests()
    exit(0 if success else 1)
