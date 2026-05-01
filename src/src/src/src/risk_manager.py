from datetime import datetime, timedelta
from config import Config
import logging

logger = logging.getLogger(__name__)

class RiskManager:
    """Advanced risk management system"""
    
    def __init__(self):
        self.daily_trades = []
        self.total_daily_loss = 0
        self.total_daily_profit = 0
        self.positions_by_city = {}
        self.start_date = datetime.now().date()
    
    def reset_daily(self):
        """Reset daily counters"""
        self.daily_trades = []
        self.total_daily_loss = 0
        self.total_daily_profit = 0
        self.positions_by_city = {}
        self.start_date = datetime.now().date()
        logger.info("Daily risk counters reset")
    
    def check_date_reset(self):
        """Check if we need to reset for a new day"""
        if datetime.now().date() != self.start_date:
            self.reset_daily()
    
    def can_trade(self, city, predicted_temp, recommended_size):
        """
        Comprehensive risk check before trading
        Returns (can_trade: bool, reason: str)
        """
        self.check_date_reset()
        
        # Check daily loss limit
        if self.total_daily_loss >= Config.DAILY_LOSS_LIMIT:
            return False, f"Daily loss limit reached: ${self.total_daily_loss}"
        
        # Check max position size
        total_exposure = sum(trade['amount'] for trade in self.daily_trades)
        if total_exposure >= Config.MAX_POSITION_SIZE:
            return False, f"Max position size reached: ${total_exposure}"
        
        # Check positions per city
        city_positions = self.positions_by_city.get(city, 0)
        if city_positions >= Config.MAX_POSITIONS_PER_CITY:
            return False, f"Max positions for {city} reached: {city_positions}"        
        # Check recommended size
        if recommended_size > Config.MAX_INVESTMENT_PER_TRADE:
            return False, f"Recommended size ${recommended_size} exceeds max ${Config.MAX_INVESTMENT_PER_TRADE}"
        
        # Check if we already have a position at this temperature
        for trade in self.daily_trades:
            if trade['city'] == city and abs(trade['temp'] - predicted_temp) < 2:
                return False, f"Similar position already exists for {city} at {trade['temp']}°C"
        
        return True, "Risk checks passed"
    
    def record_trade(self, city, temp, amount, outcome_id=None):
        """Record a trade for risk tracking"""
        self.check_date_reset()
        
        trade = {
            'city': city,
            'temp': temp,
            'amount': amount,
            'outcome_id': outcome_id,
            'timestamp': datetime.now(),
            'status': 'open'
        }
        
        self.daily_trades.append(trade)
        
        # Update city positions
        if city not in self.positions_by_city:
            self.positions_by_city[city] = 0
        self.positions_by_city[city] += 1
        
        logger.info(f"Recorded trade: {city} {temp}°C, ${amount}")
    
    def record_outcome(self, trade_index, pnl):
        """Record trade outcome (profit/loss)"""
        if 0 <= trade_index < len(self.daily_trades):
            self.daily_trades[trade_index]['pnl'] = pnl
            self.daily_trades[trade_index]['status'] = 'closed'
            
            if pnl > 0:
                self.total_daily_profit += pnl
            else:
                self.total_daily_loss += abs(pnl)
            
            logger.info(f"Trade closed: PnL ${pnl:.2f}")
    
    def get_daily_stats(self):
        """Get daily trading statistics"""
        self.check_date_reset()        
        total_exposure = sum(t['amount'] for t in self.daily_trades if t['status'] == 'open')
        open_positions = len([t for t in self.daily_trades if t['status'] == 'open'])
        
        return {
            'total_trades': len(self.daily_trades),
            'open_positions': open_positions,
            'closed_positions': len(self.daily_trades) - open_positions,
            'total_exposure': total_exposure,
            'daily_profit': self.total_daily_profit,
            'daily_loss': self.total_daily_loss,
            'net_pnl': self.total_daily_profit - self.total_daily_loss,
            'remaining_budget': Config.MAX_POSITION_SIZE - total_exposure,
            'positions_by_city': self.positions_by_city.copy()
        }
    
    def calculate_position_size(self, market_price, confidence_score, kelly_fraction=0.5):
        """
        Calculate optimal position size using Kelly Criterion
        f = (bp - q) / b
        where:
        b = odds received (1/price - 1)
        p = probability of winning (confidence)
        q = probability of losing (1-p)
        """
        if market_price <= 0 or market_price >= 1:
            return 0
        
        # Calculate odds
        odds = (1 / market_price) - 1
        
        # Kelly formula
        kelly = ((odds * confidence_score) - (1 - confidence_score)) / odds
        
        # Use fraction of Kelly for safety
        optimal_fraction = kelly * kelly_fraction
        
        # Calculate position size
        position_size = optimal_fraction * Config.MAX_POSITION_SIZE
        
        # Apply limits
        position_size = min(position_size, Config.MAX_INVESTMENT_PER_TRADE)
        position_size = max(position_size, 1)  # Minimum $1
        
        return round(position_size, 2)
    
    def get_risk_score(self, city, temp, market_liquidity):
        """
        Calculate overall risk score for a trade (0-100)
        Lower is better        """
        risk_score = 0
        
        # Liquidity risk (0-30 points)
        if market_liquidity < 1000:
            risk_score += 30
        elif market_liquidity < 3000:
            risk_score += 15
        elif market_liquidity < 5000:
            risk_score += 5
        
        # Concentration risk (0-30 points)
        city_positions = self.positions_by_city.get(city, 0)
        risk_score += min(30, city_positions * 10)
        
        # Daily exposure risk (0-40 points)
        total_exposure = sum(t['amount'] for t in self.daily_trades)
        exposure_ratio = total_exposure / Config.MAX_POSITION_SIZE
        risk_score += int(exposure_ratio * 40)
        
        return min(100, risk_score)
