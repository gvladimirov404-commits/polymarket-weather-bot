import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
import joblib
import os
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class MLPredictor:
    """Machine learning predictor for market outcomes"""
    
    def __init__(self):
        self.model = None
        self.scaler = StandardScaler()
        self.is_trained = False
        self.model_path = 'models/weather_model.pkl'
        self.training_data = []
    
    def create_features(self, market_data, weather_data):
        """
        Create features for ML model
        """
        features = {}
        
        # Weather features
        features['predicted_temp'] = weather_data.get('predicted_temp', 0)
        features['temp_range'] = weather_data.get('max_temp', 0) - weather_data.get('min_temp', 0)
        features['consensus_score'] = weather_data.get('consensus_score', 0)
        features['confidence'] = 1 if weather_data.get('confidence') == 'high' else 0
        
        # Market features
        features['market_price'] = market_data.get('price', 0.5)
        features['market_liquidity'] = market_data.get('liquidity', 0)
        features['implied_probability'] = 1 / market_data.get('price', 0.5) if market_data.get('price', 0) > 0 else 0
        
        # Temporal features
        now = datetime.now()
        features['hour'] = now.hour
        features['day_of_week'] = now.weekday()
        features['month'] = now.month
        
        # Seasonal features
        features['is_summer'] = 1 if now.month in [6, 7, 8] else 0
        features['is_winter'] = 1 if now.month in [12, 1, 2] else 0
        
        return features    
    def train_model(self, X_train, y_train):
        """
        Train the ML model
        """
        try:
            # Scale features
            X_scaled = self.scaler.fit_transform(X_train)
            
            # Try multiple models
            models = {
                'random_forest': RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42),
                'gradient_boost': GradientBoostingClassifier(n_estimators=100, max_depth=5, random_state=42),
                'logistic_regression': LogisticRegression(max_iter=1000, random_state=42)
            }
            
            best_model = None
            best_score = 0
            
            for name, model in models.items():
                model.fit(X_scaled, y_train)
                score = model.score(X_scaled, y_train)
                
                logger.info(f"{name} training accuracy: {score:.4f}")
                
                if score > best_score:
                    best_score = score
                    best_model = model
            
            self.model = best_model
            self.is_trained = True
            
            # Save model
            self.save_model()
            
            logger.info(f"Model trained successfully with accuracy: {best_score:.4f}")
            return True
            
        except Exception as e:
            logger.error(f"Error training model: {e}")
            return False
    
    def predict(self, features):
        """
        Predict outcome probability
        """
        if not self.is_trained or self.model is None:
            # Try to load model
            self.load_model()
                        if not self.is_trained:
                logger.warning("No trained model available, using default prediction")
                return 0.5
        
        try:
            # Convert features to array
            feature_values = list(features.values())
            X = np.array(feature_values).reshape(1, -1)
            
            # Scale
            X_scaled = self.scaler.transform(X)
            
            # Predict probability
            proba = self.model.predict_proba(X_scaled)[0]
            
            # Return probability of positive class
            return proba[1] if len(proba) > 1 else proba[0]
            
        except Exception as e:
            logger.error(f"Error making prediction: {e}")
            return 0.5
    
    def find_value_bets(self, markets, weather_data):
        """
        Identify value bets where our probability > market probability
        """
        value_bets = []
        
        for market in markets:
            features = self.create_features(market, weather_data)
            our_probability = self.predict(features)
            
            # Market implied probability
            market_price = market.get('price', 0.5)
            market_probability = 1 / market_price if market_price > 0 else 0.5
            
            # Calculate edge
            edge = our_probability - market_probability
            
            # If we have an edge > 5%
            if edge > 0.05:
                value_bets.append({
                    'market': market,
                    'our_probability': our_probability,
                    'market_probability': market_probability,
                    'edge': edge,
                    'features': features
                })
        
        # Sort by edge        value_bets.sort(key=lambda x: x['edge'], reverse=True)
        
        return value_bets
    
    def save_model(self):
        """Save trained model to disk"""
        try:
            os.makedirs('models', exist_ok=True)
            
            model_data = {
                'model': self.model,
                'scaler': self.scaler,
                'is_trained': self.is_trained
            }
            
            joblib.dump(model_data, self.model_path)
            logger.info(f"Model saved to {self.model_path}")
            
        except Exception as e:
            logger.error(f"Error saving model: {e}")
    
    def load_model(self):
        """Load trained model from disk"""
        try:
            if os.path.exists(self.model_path):
                model_data = joblib.load(self.model_path)
                
                self.model = model_data['model']
                self.scaler = model_data['scaler']
                self.is_trained = model_data['is_trained']
                
                logger.info(f"Model loaded from {self.model_path}")
                return True
            
        except Exception as e:
            logger.error(f"Error loading model: {e}")
        
        return False
    
    def add_training_data(self, features, outcome):
        """
        Add training data point
        outcome: 1 if prediction was correct, 0 otherwise
        """
        self.training_data.append({
            'features': features,
            'outcome': outcome,
            'timestamp': datetime.now()
        })
                # Retrain if we have enough data
        if len(self.training_data) >= 100:
            self.retrain_from_data()
    
    def retrain_from_data(self):
        """Retrain model from accumulated data"""
        if len(self.training_data) < 100:
            return False
        
        try:
            X = []
            y = []
            
            for data in self.training_data:
                feature_values = list(data['features'].values())
                X.append(feature_values)
                y.append(data['outcome'])
            
            X_array = np.array(X)
            y_array = np.array(y)
            
            return self.train_model(X_array, y_array)
            
        except Exception as e:
            logger.error(f"Error retraining model: {e}")
            return False
    
    def get_feature_importance(self):
        """Get feature importance from trained model"""
        if not self.is_trained or self.model is None:
            return None
        
        try:
            if hasattr(self.model, 'feature_importances_'):
                importance = self.model.feature_importances_
                return importance
        except:
            pass
        
        return None
