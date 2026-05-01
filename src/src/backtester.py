import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from config import Config
import logging

logger = logging.getLogger(__name__)

class Backtester:
    """Backtesting framework for strategy evaluation"""
    
    def __init__(self, strategy, initial_capital=1000):
        self.strategy = strategy
        self.initial_capital = initial_capital
        self.capital = initial_capital
        self.trades = []
        self.performance = {}
    
    def run_backtest(self, start_date, end_date, historical_data):
        """
        Run strategy on historical data
        
        Args:
            start_date: Start date (datetime)
            end_date: End date (datetime)
            historical_data: Dict with historical markets and weather data
        """
        logger.info(f"Starting backtest from {start_date} to {end_date}")
        
        self.capital = self.initial_capital
        self.trades = []
        
        current_date = start_date
        while current_date <= end_date:
            # Get historical data for this date
            date_str = current_date.strftime('%Y-%m-%d')
            
            if date_str not in historical_data:
                current_date += timedelta(days=1)
                continue
            
            day_data = historical_data[date_str]
            markets = day_data.get('markets', [])
            weather = day_data.get('weather', {})
            
            # Process each market
            for market in markets:
                city = market.get('city')
                city_weather = weather.get(city, {})
                                # Check if strategy would trade
                if self.should_trade_historical(market, city_weather):
                    trade = self.execute_historical_trade(market, city_weather)
                    if trade:
                        self.trades.append(trade)
                        self.capital += trade['pnl']
            
            current_date += timedelta(days=1)
        
        self.calculate_performance_metrics()
        return self.performance
    
    def should_trade_historical(self, market, weather):
        """
        Determine if strategy would have traded historically
        """
        # Check liquidity
        if market.get('liquidity', 0) < Config.MIN_LIQUIDITY:
            return False
        
        # Check consensus
        if weather.get('consensus_score', 0) < Config.MIN_MODEL_CONSENSUS:
            return False
        
        # Check price sum
        outcomes = market.get('outcomes', [])
        target_temps = [
            weather.get('predicted_temp', 0) - 1,
            weather.get('predicted_temp', 0),
            weather.get('predicted_temp', 0) + 1
        ]
        
        total_price = 0
        for outcome in outcomes:
            outcome_temp = outcome.get('temp', 0)
            if outcome_temp in target_temps:
                total_price += outcome.get('price', 0)
        
        if total_price >= Config.MAX_PRICE_SUM:
            return False
        
        return True
    
    def execute_historical_trade(self, market, weather):
        """
        Execute a trade on historical data
        """
        target_temp = weather.get('predicted_temp', 0)
        
        # Find matching outcomes        outcomes = market.get('outcomes', [])
        target_outcomes = []
        
        for outcome in outcomes:
            if abs(outcome.get('temp', 999) - target_temp) <= 1:
                target_outcomes.append(outcome)
        
        if not target_outcomes:
            return None
        
        # Calculate position size
        position_size = Config.MAX_INVESTMENT_PER_TRADE / len(target_outcomes)
        
        # Simulate trade
        total_invested = 0
        winning_outcome = market.get('winning_outcome')
        total_pnl = 0
        
        for outcome in target_outcomes:
            price = outcome.get('price', 0.5)
            shares = position_size / price
            total_invested += position_size
            
            if outcome.get('id') == winning_outcome:
                # Won!
                payout = shares * 1.0  # $1 per share if win
                pnl = payout - position_size
                total_pnl += pnl
        
        return {
            'date': market.get('date'),
            'city': market.get('city'),
            'market_id': market.get('id'),
            'predicted_temp': target_temp,
            'actual_temp': market.get('actual_temp'),
            'invested': total_invested,
            'pnl': total_pnl,
            'won': total_pnl > 0
        }
    
    def calculate_performance_metrics(self):
        """Calculate comprehensive performance metrics"""
        if not self.trades:
            self.performance = {
                'total_trades': 0,
                'message': 'No trades executed'
            }
            return
        
        trades_df = pd.DataFrame(self.trades)        
        # Basic metrics
        total_trades = len(trades_df)
        winning_trades = len(trades_df[trades_df['pnl'] > 0])
        losing_trades = len(trades_df[trades_df['pnl'] < 0])
        
        win_rate = winning_trades / total_trades if total_trades > 0 else 0
        
        # PnL metrics
        total_pnl = trades_df['pnl'].sum()
        total_invested = trades_df['invested'].sum()
        
        avg_win = trades_df[trades_df['pnl'] > 0]['pnl'].mean() if winning_trades > 0 else 0
        avg_loss = trades_df[trades_df['pnl'] < 0]['pnl'].mean() if losing_trades > 0 else 0
        
        profit_factor = abs(total_pnl / trades_df[trades_df['pnl'] < 0]['pnl'].sum()) if losing_trades > 0 else float('inf')
        
        # Return metrics
        total_return = (self.capital - self.initial_capital) / self.initial_capital * 100
        avg_return_per_trade = total_return / total_trades if total_trades > 0 else 0
        
        # Risk metrics
        returns = trades_df['pnl'] / trades_df['invested']
        sharpe_ratio = self.calculate_sharpe_ratio(returns)
        max_drawdown = self.calculate_max_drawdown()
        
        # Best and worst trades
        best_trade = trades_df.loc[trades_df['pnl'].idxmax()]
        worst_trade = trades_df.loc[trades_df['pnl'].idxmin()]
        
        self.performance = {
            'total_trades': total_trades,
            'winning_trades': winning_trades,
            'losing_trades': losing_trades,
            'win_rate': win_rate,
            'total_pnl': total_pnl,
            'total_invested': total_invested,
            'final_capital': self.capital,
            'total_return_percent': total_return,
            'avg_return_per_trade': avg_return_per_trade,
            'avg_win': avg_win,
            'avg_loss': avg_loss,
            'profit_factor': profit_factor,
            'sharpe_ratio': sharpe_ratio,
            'max_drawdown_percent': max_drawdown,
            'best_trade': {
                'city': best_trade['city'],
                'pnl': best_trade['pnl'],
                'date': str(best_trade['date'])
            },            'worst_trade': {
                'city': worst_trade['city'],
                'pnl': worst_trade['pnl'],
                'date': str(worst_trade['date'])
            },
            'trades': self.trades
        }
        
        # Log performance
        self.log_performance()
    
    def calculate_sharpe_ratio(self, returns, risk_free_rate=0.02):
        """Calculate Sharpe ratio"""
        if len(returns) < 2:
            return 0
        
        excess_returns = returns - risk_free_rate / 252  # Daily risk-free rate
        
        if returns.std() == 0:
            return 0
        
        sharpe = excess_returns.mean() / returns.std()
        
        # Annualize
        sharpe *= np.sqrt(252)
        
        return round(sharpe, 2)
    
    def calculate_max_drawdown(self):
        """Calculate maximum drawdown percentage"""
        if not self.trades:
            return 0
        
        # Calculate cumulative returns
        cumulative = self.initial_capital
        peak = cumulative
        max_dd = 0
        
        for trade in self.trades:
            cumulative += trade['pnl']
            
            if cumulative > peak:
                peak = cumulative
            
            drawdown = (peak - cumulative) / peak * 100
            max_dd = max(max_dd, drawdown)
        
        return round(max_dd, 2)
    
    def log_performance(self):        """Log performance metrics"""
        logger.info("=" * 60)
        logger.info("BACKTEST PERFORMANCE RESULTS")
        logger.info("=" * 60)
        logger.info(f"Total Trades: {self.performance['total_trades']}")
        logger.info(f"Win Rate: {self.performance['win_rate']:.2%}")
        logger.info(f"Total PnL: ${self.performance['total_pnl']:.2f}")
        logger.info(f"Total Return: {self.performance['total_return_percent']:.2f}%")
        logger.info(f"Sharpe Ratio: {self.performance['sharpe_ratio']}")
        logger.info(f"Max Drawdown: {self.performance['max_drawdown_percent']:.2f}%")
        logger.info(f"Profit Factor: {self.performance['profit_factor']:.2f}")
        logger.info("=" * 60)
    
    def export_results(self, filename='backtest_results.csv'):
        """Export backtest results to CSV"""
        if self.trades:
            df = pd.DataFrame(self.trades)
            df.to_csv(filename, index=False)
            logger.info(f"Results exported to {filename}")
