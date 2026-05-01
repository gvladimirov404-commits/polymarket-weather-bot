import os
import time
import schedule
import logging
from datetime import datetime
from flask import Flask, jsonify
from dotenv import load_dotenv
from config import Config
from src.strategy import WeatherStrategy
from src.risk_manager import RiskManager

load_dotenv()

# Create logs directory
os.makedirs('logs', exist_ok=True)

# Setup logging
logging.basicConfig(
    level=getattr(logging, Config.LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(Config.LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

class PolymarketWeatherBot:
    """Main bot orchestrator"""
    
    def __init__(self):
        self.strategy = WeatherStrategy()
        self.risk_manager = RiskManager()
        self.is_running = False
        self.last_run = None
        self.total_trades = 0
        self.start_time = datetime.now()
        logger.info("🤖 Polymarket Weather Bot initialized")
    
    def run(self):
        """Main bot execution"""
        try:
            logger.info("🤖 Starting bot execution cycle...")
            self.is_running = True
            
            # Check if we should reset daily counters
            if self.should_reset_daily():
                self.risk_manager.reset_daily()                logger.info("Daily counters reset")
            
            # Get wallet balance
            balance = self.strategy.client.get_balance()
            logger.info(f"Wallet balance: ${balance:.2f} USDC")
            
            # Get weather markets
            markets = self.strategy.client.get_weather_markets()
            logger.info(f"Found {len(markets)} weather markets")
            
            trades_executed = 0
            opportunities = 0
            
            for market in markets:
                should_trade, reason, confidence = self.strategy.should_trade(market)
                
                if should_trade:
                    opportunities += 1
                    logger.info(f"✅ {reason}")
                    
                    if self.strategy.execute_trade(market):
                        trades_executed += 1
                        self.total_trades += 1
                else:
                    logger.debug(f"❌ {market.get('title', 'Unknown')[:50]}... - {reason}")
            
            self.last_run = datetime.now()
            self.is_running = False
            
            # Log summary
            logger.info("=" * 60)
            logger.info(f"✅ Bot execution complete")
            logger.info(f"Markets analyzed: {len(markets)}")
            logger.info(f"Opportunities found: {opportunities}")
            logger.info(f"Trades executed: {trades_executed}")
            logger.info(f"Total trades (session): {self.total_trades}")
            logger.info("=" * 60)
            
            return {
                'status': 'success',
                'markets_analyzed': len(markets),
                'opportunities': opportunities,
                'trades_executed': trades_executed,
                'total_trades': self.total_trades,
                'timestamp': self.last_run.isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Bot execution failed: {e}", exc_info=True)
            self.is_running = False            return {
                'status': 'error',
                'message': str(e)
            }
    
    def should_reset_daily(self):
        """Check if we should reset daily counters"""
        if not self.last_run:
            return True
        
        # Reset if more than 24 hours since last run
        return (datetime.now() - self.last_run).total_seconds() > 86400
    
    def get_status(self):
        """Get comprehensive bot status"""
        uptime = datetime.now() - self.start_time
        
        return {
            'is_running': self.is_running,
            'uptime_seconds': uptime.total_seconds(),
            'last_run': self.last_run.isoformat() if self.last_run else None,
            'total_trades': self.total_trades,
            'wallet_balance': self.strategy.client.get_balance(),
            'strategy_stats': self.strategy.get_strategy_stats(),
            'risk_stats': self.risk_manager.get_daily_stats(),
            'config': {
                'check_interval_minutes': Config.CHECK_INTERVAL_MINUTES,
                'max_investment': Config.MAX_INVESTMENT_PER_TRADE,
                'min_liquidity': Config.MIN_LIQUIDITY,
                'ml_enabled': Config.ENABLE_ML_PREDICTIONS
            }
        }

# Initialize bot
bot = PolymarketWeatherBot()

# ==================== FLASK ROUTES ====================

@app.route('/')
def home():
    """Home endpoint"""
    return jsonify({
        'status': 'running',
        'bot': 'Polymarket Weather Bot',
        'version': '2.0.0',
        'author': 'Your Name'
    })

@app.route('/health')
def health():    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'uptime': (datetime.now() - bot.start_time).total_seconds()
    })

@app.route('/status')
def status():
    """Get detailed bot status"""
    return jsonify(bot.get_status())

@app.route('/run', methods=['POST'])
def trigger_run():
    """Manually trigger bot execution"""
    logger.info("Manual trigger requested")
    result = bot.run()
    return jsonify(result)

@app.route('/markets')
def get_markets():
    """Get available weather markets"""
    markets = bot.strategy.client.get_weather_markets()
    return jsonify({
        'count': len(markets),
        'markets': markets
    })

@app.route('/stats')
def get_stats():
    """Get trading statistics"""
    return jsonify({
        'strategy': bot.strategy.get_strategy_stats(),
        'risk': bot.risk_manager.get_daily_stats()
    })

@app.route('/balance')
def get_balance():
    """Get wallet balance"""
    balance = bot.strategy.client.get_balance()
    return jsonify({
        'balance': balance,
        'currency': 'USDC'
    })

# ==================== SCHEDULER ====================

def job():
    """Scheduled job"""
    bot.run()
# Schedule the bot
schedule.every(Config.CHECK_INTERVAL_MINUTES).minutes.do(job)

logger.info(f"⏰ Bot scheduled to run every {Config.CHECK_INTERVAL_MINUTES} minutes")

# ==================== MAIN ====================

if __name__ == '__main__':
    logger.info("🚀 Polymarket Weather Bot starting...")
    logger.info(f"📊 Configuration: {Config.FLASK_ENV.upper()} mode")
    logger.info(f"🔄 Check interval: {Config.CHECK_INTERVAL_MINUTES} minutes")
    logger.info(f"🤖 ML Predictions: {'Enabled' if Config.ENABLE_ML_PREDICTIONS else 'Disabled'}")
    
    # Run once at startup
    logger.info("Running initial execution...")
    bot.run()
    
    # Start Flask app
    port = Config.PORT
    logger.info(f"🌐 Starting server on port {port}")
    
    # For production with gunicorn:
    # gunicorn main:app --bind 0.0.0.0:$PORT
    
    # For development:
    app.run(host='0.0.0.0', port=port, debug=Config.DEBUG)
