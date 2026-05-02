# PolyWeather Trading Bot

An automated, 24/7 weather-based prediction market trading platform on Polymarket with a Hyperliquid-inspired dark dashboard, subscription monetization, and comprehensive risk management.

## Features

### Core Trading Bot
- **Multi-Model Weather Consensus**: Aggregates GFS, ECMWF, and ICON meteorological models with fallback strategy
- **Automated Order Execution**: 24/7 limit order placement on Polymarket with slippage protection
- **Health Checks & Fail-Safe**: Automatic connectivity monitoring with hard-stop on connection loss
- **Risk Management**: Configurable daily drawdown limits, per-trade budgets, and dynamic hedging
- **Backtesting Simulator**: Test strategies against historical weather and price data

### Dashboard & UI
- **Hyperliquid-Inspired Design**: Dark trading terminal aesthetic with cyan accents
- **Real-Time Charts**: Live P&L tracking, price action, and order book visualization
- **Position Management**: Active positions list with live updates and trade history
- **System Alerts**: Real-time notifications for trades, forecasts, and risk events

### Monetization
- **Subscription Tiers**: Free, Pro ($29.99/month), Premium ($99.99/month) in USDT/Polygon
- **Non-Custodial Wallet**: WalletConnect and MetaMask integration with on-chain payment verification
- **Referral System**: Unique referral codes with automatic commission tracking
- **Admin Panel**: User management, analytics, and subscription controls

### Security & Compliance
- **Non-Custodial Architecture**: No private keys stored; users sign transactions with their wallets
- **Rate Limiting**: API and UI protection against brute-force and DDoS attacks
- **Encryption**: AES-256-GCM for sensitive data at rest
- **Audit Logging**: Complete security event trail for compliance
- **Input Validation**: Sanitization and validation across all inputs

### Internationalization
- **Multi-Language Support**: Bulgarian and English translations
- **Dynamic Language Switching**: User preference persistence
- **Translated Admin Panel**: Full localization of all interfaces

## Architecture

### Database Schema
- **users**: Core user data with subscription and wallet info
- **subscriptionPayments**: USDT/Polygon payment tracking
- **referralCommissions**: Referral tracking and commission calculation
- **positions**: Active trading positions on Polymarket
- **trades**: Complete trade execution history
- **weatherSnapshots**: Historical weather data for backtesting
- **alerts**: User notifications (Telegram, Discord, Email)
- **botHealthLogs**: Bot status and connectivity monitoring
- **backTestResults**: Backtesting simulation results
- **auditLogs**: Security and compliance audit trail

### Technology Stack
- **Frontend**: React 19 + Tailwind CSS 4 + Recharts
- **Backend**: Node.js + Express + tRPC 11
- **Database**: MySQL/TiDB
- **Authentication**: Manus OAuth + Wallet Connect
- **Weather APIs**: Windy.com (primary), OpenWeather (fallback)
- **Trading APIs**: Polymarket CLOB API
- **Blockchain**: Polygon (Chain ID: 137)

## Getting Started

### Prerequisites
- Node.js 22.13.0+
- pnpm 10.15.1+
- MySQL/TiDB database
- Wallet Connect Project ID
- API keys: Windy, OpenWeather, Polymarket

### Installation

```bash
# Clone repository
git clone <repo-url>
cd polyweather-bot

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env.local

# Run migrations
pnpm drizzle-kit generate
pnpm drizzle-kit migrate

# Start development server
pnpm dev
```

### Environment Variables

```env
# Database
DATABASE_URL=mysql://user:password@localhost:3306/polyweather

# Authentication
VITE_APP_ID=your_manus_app_id
OAUTH_SERVER_URL=https://api.manus.im
JWT_SECRET=your_jwt_secret

# Wallet & Blockchain
VITE_WALLET_CONNECT_PROJECT_ID=your_project_id
POLYGON_RPC_URL=https://polygon-rpc.com
USDT_CONTRACT_ADDRESS=0xc2132D05D31c914a87C6611C10748AEb04B58e8F

# APIs
WINDY_API_KEY=your_windy_key
OPENWEATHER_API_KEY=your_openweather_key
POLYMARKET_API_KEY=your_polymarket_key

# Notifications
TELEGRAM_BOT_TOKEN=your_telegram_token
DISCORD_WEBHOOK_URL=your_discord_webhook

# Owner
OWNER_OPEN_ID=your_manus_open_id
OWNER_NAME=Your Name
```

## API Routes

### Authentication
- `POST /api/oauth/callback` - OAuth callback handler
- `POST /api/trpc/auth.logout` - User logout

### Trading
- `POST /api/trpc/positions.list` - Get user positions
- `POST /api/trpc/positions.active` - Get active positions
- `POST /api/trpc/trades.list` - Get trade history
- `POST /api/trpc/trades.create` - Execute new trade

### Subscription
- `POST /api/trpc/subscription.status` - Check subscription status
- `POST /api/trpc/subscription.verifyPayment` - Verify on-chain payment

### Referrals
- `POST /api/trpc/referrals.stats` - Get referral statistics
- `POST /api/trpc/referrals.generateCode` - Generate referral code

### Admin
- `POST /api/trpc/admin.users` - List all users (admin only)
- `POST /api/trpc/admin.analytics` - Platform analytics (admin only)

## Trading Strategy

### Weather Consensus Algorithm
1. Fetch temperature forecasts from GFS, ECMWF, and ICON models
2. Calculate average temperature across models
3. Check if all models agree within ±1°C tolerance
4. If consensus reached, generate buy signal for matching temperature bin
5. Place limit order with slippage protection

### Risk Management
- **Max Daily Drawdown**: Halt trading if daily loss exceeds limit
- **Per-Trade Budget**: Fixed USDT amount per trade
- **Slippage Protection**: Cancel orders if execution price deviates >2%
- **Dynamic Hedging**: Close positions if forecast changes >1°C

### Fail-Safe Mechanism
- Health checks every 60 seconds
- Halt all trading if API connectivity lost
- Automatic error recovery with max 3 consecutive errors
- Alert user immediately on fail-safe activation

## Testing

```bash
# Run unit tests
pnpm test

# Run tests in watch mode
pnpm test --watch

# Generate coverage report
pnpm test --coverage
```

## Deployment

### Production Build
```bash
pnpm build
pnpm start
```

### Hosting Options
- **Manus Platform**: Built-in hosting with custom domains
- **Railway**: Recommended for production
- **Render**: Alternative option
- **Vercel**: Frontend only

### Database Backup
```bash
# Backup MySQL database
mysqldump -u user -p database_name > backup.sql

# Restore from backup
mysql -u user -p database_name < backup.sql
```

## Security Considerations

### Non-Custodial Wallet
- Users connect wallets via WalletConnect/MetaMask
- Platform never receives private keys
- All transactions signed by user's wallet
- Subscription payments verified on-chain

### API Security
- Rate limiting: 100 requests/minute per IP
- Brute-force protection: 5 failed attempts = 15-minute lockout
- CSRF tokens on all state-changing operations
- Input validation and sanitization on all endpoints

### Data Protection
- Sensitive data encrypted with AES-256-GCM
- Audit logs for all admin actions
- Compliance with GDPR and data protection regulations

## Monitoring & Alerting

### Key Metrics
- Active users and subscription revenue
- Total trading volume and platform P&L
- Bot uptime and error rates
- API latency and response times

### Alert Triggers
- Bot offline for >5 minutes
- API error rate >5%
- Database connection failures
- Unusual trading activity (potential exploit)

## Support & Documentation

- **User Guide**: `/docs/user-guide.md`
- **API Documentation**: `/docs/api.md`
- **Trading Strategy**: `/docs/strategy.md`
- **Troubleshooting**: `/docs/troubleshooting.md`

## License

MIT License - See LICENSE file for details

## Contributing

Contributions welcome! Please follow these guidelines:
1. Create feature branch (`git checkout -b feature/amazing-feature`)
2. Commit changes (`git commit -m 'Add amazing feature'`)
3. Push to branch (`git push origin feature/amazing-feature`)
4. Open Pull Request

## Roadmap

- [ ] Advanced backtesting with Monte Carlo simulation
- [ ] Machine learning model for forecast weighting
- [ ] Mobile app (iOS/Android)
- [ ] Advanced charting with TradingView integration
- [ ] Social trading features (copy trading)
- [ ] Automated portfolio rebalancing
- [ ] Multi-chain support (Ethereum, Arbitrum)

## Contact

- **Email**: support@polyweather.app
- **Twitter**: @PolyWeatherBot
- **Discord**: [Join our community](https://discord.gg/polyweather)

---

**Built with ❤️ by the PolyWeather Team**
