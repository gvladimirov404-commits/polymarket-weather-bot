from config import Config
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

class PortfolioManager:
    """Manage portfolio diversification and correlation"""
    
    def __init__(self):
        self.positions = []
        self.city_correlations = {}
    
    def add_position(self, city, market_id, outcome_id, amount, temp):
        """Add a new position to portfolio"""
        position = {
            'city': city,
            'market_id': market_id,
            'outcome_id': outcome_id,
            'amount': amount,
            'temp': temp,
            'timestamp': datetime.now(),
            'status': 'open'
        }
        
        self.positions.append(position)
        logger.info(f"Added position: {city} {temp}°C - ${amount}")
    
    def close_position(self, market_id, pnl):
        """Close a position and record PnL"""
        for pos in self.positions:
            if pos['market_id'] == market_id and pos['status'] == 'open':
                pos['status'] = 'closed'
                pos['pnl'] = pnl
                pos['closed_at'] = datetime.now()
                logger.info(f"Closed position {market_id}: PnL ${pnl}")
                return True
        return False
    
    def get_city_exposure(self, city):
        """Get total exposure for a city"""
        return sum(p['amount'] for p in self.positions 
                  if p['city'] == city and p['status'] == 'open')
    
    def get_total_exposure(self):
        """Get total portfolio exposure"""
        return sum(p['amount'] for p in self.positions if p['status'] == 'open')
    
    def get_open_positions(self):
        """Get all open positions"""        return [p for p in self.positions if p['status'] == 'open']
    
    def can_open_position(self, city, amount):
        """
        Check if we can open a new position
        Based on diversification rules
        """
        # Check city concentration
        city_exposure = self.get_city_exposure(city)
        total_exposure = self.get_total_exposure()
        
        # Don't allow more than 20% in one city
        if total_exposure > 0:
            new_city_ratio = (city_exposure + amount) / (total_exposure + amount)
            if new_city_ratio > 0.20:
                logger.warning(f"City concentration too high for {city}: {new_city_ratio:.2%}")
                return False
        
        # Check total exposure
        if total_exposure + amount > Config.MAX_POSITION_SIZE:
            logger.warning(f"Total exposure limit reached: ${total_exposure + amount}")
            return False
        
        # Check for correlated positions
        if self.has_correlated_position(city):
            logger.warning(f"Correlated position already exists for {city}")
            return False
        
        return True
    
    def has_correlated_position(self, city):
        """
        Check if we have a correlated position
        (e.g., neighboring cities, same weather pattern)
        """
        # Simple correlation: same city or nearby cities
        correlated_cities = {
            'New York': ['Boston', 'Philadelphia', 'Washington'],
            'Los Angeles': ['San Diego', 'San Francisco'],
            'London': ['Manchester', 'Birmingham'],
            'Paris': ['Lyon', 'Marseille']
        }
        
        city_group = correlated_cities.get(city, [city])
        
        for pos in self.get_open_positions():
            if pos['city'] in city_group:
                return True
        
        return False    
    def get_portfolio_stats(self):
        """Get portfolio statistics"""
        open_positions = self.get_open_positions()
        
        cities = {}
        total_pnl = 0
        
        for pos in self.positions:
            if pos['city'] not in cities:
                cities[pos['city']] = 0
            cities[pos['city']] += pos['amount']
            
            if pos.get('pnl'):
                total_pnl += pos['pnl']
        
        return {
            'total_positions': len(self.positions),
            'open_positions': len(open_positions),
            'total_exposure': self.get_total_exposure(),
            'total_pnl': total_pnl,
            'cities': cities,
            'diversification_score': self.calculate_diversification_score()
        }
    
    def calculate_diversification_score(self):
        """
        Calculate portfolio diversification score (0-100)
        Higher is better
        """
        open_positions = self.get_open_positions()
        
        if not open_positions:
            return 100
        
        cities = {}
        for pos in open_positions:
            cities[pos['city']] = cities.get(pos['city'], 0) + pos['amount']
        
        total = sum(cities.values())
        if total == 0:
            return 100
        
        # Calculate Herfindahl index
        hhi = sum((amount/total)**2 for amount in cities.values())
        
        # Convert to diversification score
        # HHI of 1/n means perfect diversification
        n = len(cities)
        perfect_hhi = 1/n if n > 0 else 1        
        score = (1 - (hhi - perfect_hhi) / (1 - perfect_hhi)) * 100
        
        return max(0, min(100, score))
    
    def rebalance_needed(self):
        """
        Check if portfolio needs rebalancing
        """
        stats = self.get_portfolio_stats()
        
        # Need rebalancing if:
        # - Any city > 25% of portfolio
        # - Diversification score < 60
        
        if stats['diversification_score'] < 60:
            return True, "Low diversification score"
        
        total = stats['total_exposure']
        if total > 0:
            for city, exposure in stats['cities'].items():
                if exposure / total > 0.25:
                    return True, f"{city} over-concentrated: {exposure/total:.2%}"
        
        return False, "Portfolio balanced"
