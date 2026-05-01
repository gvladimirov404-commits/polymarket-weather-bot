from config import Config
import logging

logger = logging.getLogger(__name__)

class LiquidityOptimizer:
    """Optimize order execution based on liquidity"""
    
    def __init__(self, client):
        self.client = client
    
    def analyze_order_book(self, market_id):
        """
        Analyze order book depth and spread
        Returns liquidity metrics
        """
        order_book = self.client.get_order_book(market_id)
        
        if not order_book:
            return None
        
        bids = order_book.get('bids', [])
        asks = order_book.get('asks', [])
        
        if not bids or not asks:
            return None
        
        # Calculate spread
        best_bid = max(float(b['price']) for b in bids)
        best_ask = min(float(a['price']) for a in asks)
        spread = best_ask - best_bid
        spread_percent = (spread / best_bid) * 100
        
        # Calculate depth
        bid_depth = sum(float(b['size']) * float(b['price']) for b in bids[:10])
        ask_depth = sum(float(a['size']) * float(a['price']) for a in asks[:10])
        
        # Calculate slippage for different order sizes
        slippage_10 = self.estimate_slippage(bids, asks, 10)
        slippage_50 = self.estimate_slippage(bids, asks, 50)
        slippage_100 = self.estimate_slippage(bids, asks, 100)
        
        return {
            'spread': spread,
            'spread_percent': spread_percent,
            'best_bid': best_bid,
            'best_ask': best_ask,
            'bid_depth': bid_depth,
            'ask_depth': ask_depth,
            'total_depth': bid_depth + ask_depth,            'slippage_10': slippage_10,
            'slippage_50': slippage_50,
            'slippage_100': slippage_100,
            'liquidity_score': self.calculate_liquidity_score(spread_percent, bid_depth + ask_depth)
        }
    
    def estimate_slippage(self, bids, asks, order_size):
        """Estimate slippage for a given order size"""
        # For buy order
        remaining_size = order_size
        total_cost = 0
        filled_size = 0
        
        sorted_asks = sorted(asks, key=lambda x: float(x['price']))
        
        for ask in sorted_asks:
            price = float(ask['price'])
            size = float(ask['size'])
            
            if remaining_size <= 0:
                break
            
            fill_size = min(remaining_size, size)
            total_cost += fill_size * price
            filled_size += fill_size
            remaining_size -= fill_size
        
        if filled_size == 0:
            return float('inf')
        
        avg_price = total_cost / filled_size
        mid_price = (float(sorted_asks[0]['price']) + float(bids[0]['price'])) / 2
        slippage = ((avg_price - mid_price) / mid_price) * 100
        
        return slippage
    
    def calculate_liquidity_score(self, spread_percent, total_depth):
        """
        Calculate liquidity score (0-100)
        Higher is better
        """
        # Spread score (0-50)
        if spread_percent < 1:
            spread_score = 50
        elif spread_percent < 3:
            spread_score = 40
        elif spread_percent < 5:
            spread_score = 30
        elif spread_percent < 10:
            spread_score = 20        else:
            spread_score = 10
        
        # Depth score (0-50)
        if total_depth > 10000:
            depth_score = 50
        elif total_depth > 5000:
            depth_score = 40
        elif total_depth > 3000:
            depth_score = 30
        elif total_depth > 1000:
            depth_score = 20
        else:
            depth_score = 10
        
        return spread_score + depth_score
    
    def find_optimal_entry(self, order_book, target_price):
        """
        Find optimal entry point based on order book
        Returns recommended limit price
        """
        if not order_book:
            return target_price
        
        bids = order_book.get('bids', [])
        
        if not bids:
            return target_price
        
        # Find price with good liquidity
        sorted_bids = sorted(bids, key=lambda x: float(x['price']), reverse=True)
        
        for bid in sorted_bids[:5]:
            price = float(bid['price'])
            size = float(bid['size'])
            
            if size >= 50:  # Good liquidity
                return price * 0.995  # Slightly below for better fill
        
        # Default: place order slightly below best bid
        best_bid = float(sorted_bids[0]['price'])
        return best_bid * 0.99
    
    def should_use_limit_order(self, market_id, order_size):
        """
        Determine if we should use limit order vs market order
        """
        liquidity = self.analyze_order_book(market_id)
                if not liquidity:
            return True  # Default to limit order
        
        # Use limit order if:
        # - Spread is wide (>2%)
        # - Slippage would be high
        # - Order size is significant relative to depth
        
        if liquidity['spread_percent'] > 2:
            return True
        
        if order_size > liquidity['total_depth'] * 0.1:
            return True
        
        return False
    
    def calculate_optimal_order_size(self, market_id, max_risk_amount):
        """
        Calculate optimal order size based on liquidity
        """
        liquidity = self.analyze_order_book(market_id)
        
        if not liquidity:
            return max_risk_amount * 0.5  # Conservative
        
        # Don't use more than 5% of total depth
        max_from_depth = liquidity['total_depth'] * 0.05
        
        # Don't accept more than 2% slippage
        if liquidity['slippage_50'] > 2:
            max_from_slippage = 10  # Reduce to $10
        else:
            max_from_slippage = 50
        
        optimal_size = min(max_risk_amount, max_from_depth, max_from_slippage)
        
        return round(optimal_size, 2)
