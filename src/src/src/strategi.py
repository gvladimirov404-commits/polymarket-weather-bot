from src.weather_api import WeatherAPI
from src.polymarket_client import PolymarketClient
from src.risk_manager import RiskManager
from src.liquidity_optimizer import LiquidityOptimizer
from src.portfolio_manager import PortfolioManager
from src.ml_predictor import MLPredictor
from config import Config
import logging

logger = logging.getLogger(__name__)

class WeatherStrategy:
    """
    Optimized weather trading strategy
    Combines weather forecasting, risk management, and ML predictions
    """
    
    def __init__(self):
        self.weather = WeatherAPI()
        self.client = PolymarketClient()
        self.risk_manager = RiskManager()
        self.liquidity_optimizer = LiquidityOptimizer(self.client)
        self.portfolio_manager = PortfolioManager()
        self.ml_predictor = MLPredictor()
        
        self.trades_executed = 0
        self.total_pnl = 0
    
    def should_trade(self, market):
        """
        Comprehensive decision-making for trading
        Returns (should_trade: bool, reason: str, confidence: float)
        """
        try:
            # Check if it's a temperature market
            if 'temperature' not in market.get('title', '').lower():
                return False, "Not a temperature market", 0
            
            # Extract city
            city = self.extract_city_from_market(market.get('title', ''))
            if not city:
                return False, "Could not extract city", 0
            
            # Get weather forecast
            forecast = self.weather.get_temperature_consensus(city)
            if not forecast:
                return False, "No weather forecast available", 0
            
            # Check confidence
            if forecast['consensus_score'] < Config.MIN_MODEL_CONSENSUS:                return False, f"Low consensus score: {forecast['consensus_score']:.2f}", forecast['consensus_score']
            
            # Check liquidity
            liquidity = self.client.get_market_liquidity(market['id'])
            if liquidity < Config.MIN_LIQUIDITY:
                return False, f"Low liquidity: ${liquidity}", 0
            
            # Analyze order book
            order_book_analysis = self.liquidity_optimizer.analyze_order_book(market['id'])
            if order_book_analysis and order_book_analysis['liquidity_score'] < 50:
                return False, f"Poor liquidity score: {order_book_analysis['liquidity_score']}", 0
            
            # Get outcomes and check prices
            outcomes = self.client.get_market_outcomes(market['id'])
            if not outcomes:
                return False, "No outcomes available", 0
            
            # Find relevant outcomes
            target_temps = [
                forecast['predicted_temp'] - Config.TEMPERATURE_RANGE,
                forecast['predicted_temp'],
                forecast['predicted_temp'] + Config.TEMPERATURE_RANGE
            ]
            
            relevant_outcomes = []
            total_price = 0
            
            for outcome in outcomes:
                outcome_temp = self.extract_temp_from_outcome(outcome.get('title', ''))
                if outcome_temp is not None and outcome_temp in target_temps:
                    price = self.client.get_market_price(outcome['id'])
                    if price > 0 and price < 0.95:  # Avoid overpriced outcomes
                        relevant_outcomes.append({
                            'id': outcome['id'],
                            'temp': outcome_temp,
                            'price': price
                        })
                        total_price += price
            
            # Check price sum
            if total_price >= Config.MAX_PRICE_SUM:
                return False, f"Price sum too high: {total_price:.2f}", 0
            
            # ML prediction (if enabled)
            if Config.ENABLE_ML_PREDICTIONS:
                market_data = {
                    'price': total_price / len(relevant_outcomes) if relevant_outcomes else 0.5,
                    'liquidity': liquidity
                }
                                ml_probability = self.ml_predictor.predict(
                    self.ml_predictor.create_features(market_data, forecast)
                )
                
                if ml_probability < 0.55:  # Need at least 55% confidence
                    return False, f"ML prediction too low: {ml_probability:.2f}", ml_probability
            
            # Risk management check
            recommended_size = self.calculate_position_size(relevant_outcomes, forecast['consensus_score'])
            can_trade, risk_reason = self.risk_manager.can_trade(city, forecast['predicted_temp'], recommended_size)
            
            if not can_trade:
                return False, f"Risk check failed: {risk_reason}", 0
            
            # Portfolio diversification check
            if not self.portfolio_manager.can_open_position(city, recommended_size):
                return False, "Portfolio diversification limit reached", 0
            
            # Calculate overall confidence
            confidence = (
                forecast['consensus_score'] * 0.4 +
                (1 - total_price / Config.MAX_PRICE_SUM) * 0.3 +
                (order_book_analysis['liquidity_score'] / 100) * 0.2 +
                (0.6 if Config.ENABLE_ML_PREDICTIONS else 0.5) * 0.1
            )
            
            reason = (f"Good opportunity: {city} {forecast['predicted_temp']}°C, "
                     f"Price sum: {total_price:.2f}, Confidence: {confidence:.2f}")
            
            return True, reason, confidence
            
        except Exception as e:
            logger.error(f"Error in should_trade: {e}")
            return False, f"Error: {str(e)}", 0
    
    def execute_trade(self, market):
        """Execute the trading strategy with optimizations"""
        try:
            city = self.extract_city_from_market(market.get('title', ''))
            forecast = self.weather.get_temperature_consensus(city)
            
            if not forecast:
                logger.error(f"No forecast for {city}")
                return False
            
            target_temps = [
                forecast['predicted_temp'] - Config.TEMPERATURE_RANGE,
                forecast['predicted_temp'],
                forecast['predicted_temp'] + Config.TEMPERATURE_RANGE
            ]            
            outcomes = self.client.get_market_outcomes(market['id'])
            
            # Calculate position size
            position_size = self.calculate_position_size(
                [o for o in outcomes if self.extract_temp_from_outcome(o.get('title', '')) in target_temps],
                forecast['consensus_score']
            )
            
            trades_executed = 0
            total_invested = 0
            
            for outcome in outcomes:
                outcome_temp = self.extract_temp_from_outcome(outcome.get('title', ''))
                if outcome_temp is None or outcome_temp not in target_temps:
                    continue
                
                current_price = self.client.get_market_price(outcome['id'])
                
                # Use limit order for better execution
                order_book = self.client.get_order_book(market['id'])
                limit_price = self.liquidity_optimizer.find_optimal_entry(order_book, current_price)
                
                # Place order
                order = self.client.place_order(
                    market_id=market['id'],
                    outcome_id=outcome['id'],
                    side='buy',
                    size=position_size,
                    price=limit_price
                )
                
                if order:
                    trades_executed += 1
                    total_invested += position_size
                    
                    # Record in portfolio
                    self.portfolio_manager.add_position(
                        city=city,
                        market_id=market['id'],
                        outcome_id=outcome['id'],
                        amount=position_size,
                        temp=outcome_temp
                    )
                    
                    # Record in risk manager
                    self.risk_manager.record_trade(
                        city=city,
                        temp=outcome_temp,
                        amount=position_size,                        outcome_id=outcome['id']
                    )
                    
                    logger.info(f"✅ Placed order for {outcome_temp}°C @ ${limit_price:.3f}")
            
            if trades_executed > 0:
                self.trades_executed += 1
                logger.info(f"Executed {trades_executed} orders in {city}, Total: ${total_invested:.2f}")
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error executing trade: {e}")
            return False
    
    def calculate_position_size(self, outcomes, confidence_score):
        """Calculate optimal position size"""
        if not outcomes:
            return 0
        
        # Get average price
        avg_price = sum(o['price'] for o in outcomes) / len(outcomes)
        
        # Use risk manager's Kelly criterion
        position_size = self.risk_manager.calculate_position_size(
            market_price=avg_price,
            confidence_score=confidence_score,
            kelly_fraction=Config.KELLY_CRITERION_FRACTION
        )
        
        # Apply limits
        position_size = min(position_size, Config.MAX_INVESTMENT_PER_TRADE / len(outcomes))
        position_size = max(position_size, 1)  # Minimum $1
        
        return round(position_size, 2)
    
    def extract_city_from_market(self, title):
        """Extract city name from market title"""
        try:
            # Common patterns
            patterns = [
                'in ',
                'at ',
                'for '
            ]
            
            for pattern in patterns:
                if pattern in title.lower():
                    idx = title.lower().find(pattern) + len(pattern)                    rest = title[idx:]
                    city = rest.split()[0:2]  # City might be 2 words
                    city_name = ' '.join(city).rstrip('?').rstrip(',')
                    
                    # Validate against known cities
                    for known_city in Config.MONITORED_CITIES:
                        if known_city.lower() in city_name.lower():
                            return known_city
                    
                    return city_name
        except:
            pass
        return None
    
    def extract_temp_from_outcome(self, title):
        """Extract temperature from outcome title"""
        try:
            import re
            # Look for numbers followed by °C or degrees
            matches = re.findall(r'(\d+)\s*(?:°C|degrees?|C)', title, re.IGNORECASE)
            if matches:
                return int(matches[0])
            
            # Alternative: just look for numbers
            numbers = re.findall(r'\b(\d{1,3})\b', title)
            if numbers:
                # Filter reasonable temperatures
                for num in numbers:
                    temp = int(num)
                    if -50 <= temp <= 60:  # Reasonable temperature range
                        return temp
        except:
            pass
        return None
    
    def get_strategy_stats(self):
        """Get strategy statistics"""
        return {
            'trades_executed': self.trades_executed,
            'total_pnl': self.total_pnl,
            'portfolio': self.portfolio_manager.get_portfolio_stats(),
            'risk': self.risk_manager.get_daily_stats()
        }
