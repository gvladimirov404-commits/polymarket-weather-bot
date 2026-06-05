cat > index.js << 'EOF'
require('dotenv').config();
const express = require('express');
const { ClobClient } = require('@polymarket/clob-client');
const { privateKeyToAccount } = require('viem/accounts');
const { createWalletClient, http } = require('viem');
const { polygon } = require('viem/chains');
const { getRealUSDCBalance } = require('./balanceChecker');

const app = express();
const PORT = 3000;
const WALLET_ADDRESS = '0xfC74Aeb8eaCf185A4D1c4EC6a4A1aC60702E4785';

let startingBalance = null;
let lastTradeTime = 0;
const COOLDOWN_MS = 60000;
let clobClient = null;

global.realBalance = { current: 0, starting: null, pnl: 0 };
global.tradeLog = [];

async function initClob() {
    try {
        const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
        if (!privateKey) throw new Error('❌ Липсва POLYMARKET_PRIVATE_KEY в .env');
        
        const account = privateKeyToAccount(privateKey);
        const signer = createWalletClient({ account, transport: http('https://polygon-rpc.com'), chain: polygon });
        console.log(`✅ Адрес: ${account.address}`);

        const tempClient = new ClobClient({ host: 'https://clob.polymarket.com', chain: 137, signer });
        const apiCreds = await tempClient.createOrDeriveApiKey();
        console.log("✅ L2 credentials извлечени");

        clobClient = new ClobClient({ host: 'https://clob.polymarket.com', chain: 137, signer, creds: apiCreds, signatureType: 3, funderAddress: account.address });
        console.log("✅ ClobClient готов за търговия");
    } catch (error) {
        console.error('❌ CLOB грешка:', error.message);
    }
}

async function updateRealBalance() {
    const result = await getRealUSDCBalance(WALLET_ADDRESS);
    if (result.success) {
        if (startingBalance === null) startingBalance = result.balance;
        const pnl = result.balance - startingBalance;
        global.realBalance = { current: result.balance, starting: startingBalance, pnl, success: true };
        console.log(`💰 Баланс: ${result.balance.toFixed(4)} USDC | П/З: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)}`);
    } else {
        global.realBalance = { success: false, error: result.error };
    }
}

async function executeTrade() {
    if (Date.now() - lastTradeTime < COOLDOWN_MS) return console.log('✖ Cooldown');
    if (!clobClient) { console.log('❌ CLOB не е готов'); return; }
    
    lastTradeTime = Date.now();
    console.log(`🚀 ИЗПРАЩАМ РЕАЛЕН ОРДЕР за $1.00 на ${new Date().toLocaleTimeString()}`);
    
    try {
        // Временен тестов ордер (ще го заменим с реален пазар)
        console.log('📝 Ордерът ще бъде изпратен след като добавим market token ID');
        // Тук ще дойде clobClient.postOrder()
    } catch (error) {
        console.error('❌ Грешка при ордер:', error.message);
    }
}

app.get('/', (req, res) => res.send(`<h1>HyperMeteo V4</h1><pre>${JSON.stringify(global.realBalance, null, 2)}</pre>`));
app.get('/balance', (req, res) => res.json(global.realBalance));

async function start() {
    await initClob();
    await updateRealBalance();
    setInterval(executeTrade, 60000);
    setInterval(updateRealBalance, 60000);
    app.listen(PORT, '0.0.0.0', () => console.log(`🌐 http://89.117.152.7:${PORT}`));
}
start().catch(console.error);
EOF
