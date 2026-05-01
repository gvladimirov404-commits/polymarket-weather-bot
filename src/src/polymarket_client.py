import requests
import hmac
import hashlib
import time
import json
from web3 import Web3
from eth_account import Account
from config import Config
import logging

logger = logging.getLogger(__name__)

class PolymarketClient:
    """Client for Polymarket API interactions"""
    
    def __init__(self):
        self.api_key = Config.POLYMARKET_API_KEY
        self.secret = Config.POLYMARKET_SECRET
        self.base_url = 'https://gamma-api.polymarket.com'
        self.clob_url = 'https://clob.polymarket.com'
        
        # Initialize Web3 for Polygon
        self.w3 = Web3(Web3.HTTPProvider('https://polygon-rpc.com'))
        
        if Config.WALLET_PRIVATE_KEY:
            self.account = Account.from_key(Config.WALLET_PRIVATE_KEY)
        else:
            self.account = None
            logger.warning("No wallet private key configured")
        
        self.headers = {
            'POLYMARKET_API_KEY': self.api_key,
            'Content-Type': 'application/json'
        }
    
    def generate_signature(self, method, path, timestamp, body=''):
        """Generate CLOB signature for authenticated requests"""
        message = f"{timestamp}{method}{path}"
        if body:
            message += body
        
        signature = hmac.new(
            self.secret.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        
        return signature
    
    def get_auth_headers(self, method, path, body=''):        """Get authenticated headers for API requests"""
        timestamp = str(int(time.time()))
        signature = self.generate_signature(method, path, timestamp, body)
        
        return {
            'POLYMARKET_API_KEY': self.api_key,
            'POLYMARKET_SIGNATURE': signature,
            'POLYMARKET_TIMESTAMP': timestamp,
            'Content-Type': 'application/json'
        }
    
    def get_weather_markets(self):
        """Get all weather-related markets"""
        try:
            response = requests.get(
                f'{self.base_url}/events',
                params={'category': 'weather'},
                headers=self.headers,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                markets = data.get('events', [])
                logger.info(f"Fetched {len(markets)} weather markets")
                return markets
            else:
                logger.error(f"Error fetching markets: {response.status_code} - {response.text}")
                return []
                
        except Exception as e:
            logger.error(f"Exception in get_weather_markets: {e}")
            return []
    
    def get_market_outcomes(self, market_id):
        """Get outcomes for a specific market"""
        try:
            response = requests.get(
                f'{self.base_url}/markets/{market_id}',
                headers=self.headers,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                return data.get('outcomes', [])
            return []
            
        except Exception as e:
            logger.error(f"Error getting market outcomes: {e}")            return []
    
    def get_market_liquidity(self, market_id):
        """Get liquidity for a market"""
        try:
            response = requests.get(
                f'{self.clob_url}/book',
                params={'token_id': market_id},
                headers=self.headers,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                bids = data.get('bids', [])
                asks = data.get('asks', [])
                
                total_liquidity = 0
                for bid in bids:
                    total_liquidity += float(bid.get('size', 0)) * float(bid.get('price', 0))
                for ask in asks:
                    total_liquidity += float(ask.get('size', 0)) * float(ask.get('price', 0))
                
                return total_liquidity
            return 0
            
        except Exception as e:
            logger.error(f"Error getting liquidity: {e}")
            return 0
    
    def get_market_price(self, outcome_id):
        """Get current price for an outcome"""
        try:
            response = requests.get(
                f'{self.clob_url}/price',
                params={'token_id': outcome_id},
                headers=self.headers,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                return float(data.get('price', 0))
            return 0
            
        except Exception as e:
            logger.error(f"Error getting price: {e}")
            return 0
    
    def get_order_book(self, market_id):        """Get full order book for a market"""
        try:
            response = requests.get(
                f'{self.clob_url}/book',
                params={'token_id': market_id},
                headers=self.headers,
                timeout=10
            )
            
            if response.status_code == 200:
                return response.json()
            return {'bids': [], 'asks': []}
            
        except Exception as e:
            logger.error(f"Error getting order book: {e}")
            return {'bids': [], 'asks': []}
    
    def place_order(self, market_id, outcome_id, side, size, price):
        """Place a limit order"""
        try:
            payload = {
                'market': market_id,
                'outcome': outcome_id,
                'side': side,
                'size': size,
                'price': price,
                'order_type': 'limit'
            }
            
            body = json.dumps(payload)
            headers = self.get_auth_headers('POST', '/order', body)
            
            response = requests.post(
                f'{self.clob_url}/order',
                headers=headers,
                data=body,
                timeout=10
            )
            
            if response.status_code == 200:
                logger.info(f"✅ Order placed: {outcome_id} {side} {size} @ ${price}")
                return response.json()
            else:
                logger.error(f"❌ Order failed: {response.status_code} - {response.text}")
                return None
                
        except Exception as e:
            logger.error(f"Error placing order: {e}")
            return None
        def get_balance(self, asset='USDC'):
        """Get wallet balance"""
        if not self.account:
            logger.warning("No wallet configured")
            return 0
        
        try:
            if asset == 'USDC':
                usdc_contract = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
                contract = self.w3.eth.contract(
                    address=usdc_contract,
                    abi=[{
                        "constant": True,
                        "inputs": [{"name": "_owner", "type": "address"}],
                        "name": "balanceOf",
                        "outputs": [{"name": "balance", "type": "uint256"}],
                        "type": "function"
                    }]
                )
                
                balance = contract.functions.balanceOf(self.account.address).call()
                return balance / 1e6
            
            return 0
            
        except Exception as e:
            logger.error(f"Error getting balance: {e}")
            return 0
    
    def cancel_order(self, order_id):
        """Cancel an order"""
        try:
            payload = {'order_id': order_id}
            body = json.dumps(payload)
            headers = self.get_auth_headers('POST', '/cancel', body)
            
            response = requests.post(
                f'{self.clob_url}/cancel',
                headers=headers,
                data=body,
                timeout=10
            )
            
            if response.status_code == 200:
                logger.info(f"✅ Order cancelled: {order_id}")
                return True
            return False
            
        except Exception as e:
            logger.error(f"Error cancelling order: {e}")            return False
