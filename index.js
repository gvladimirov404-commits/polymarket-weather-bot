require('dotenv').config();
const express = require('express');
const { ClobClient, Side, OrderType } = require('@polymarket/clob-client-v2');
const { privateKeyToAccount } = require('viem/accounts');
const { createWalletClient, http } = require('viem');
const { polygon } = require('viem/chains');
const { getRealUSDCBalance } = require('./balanceChecker');

const app = express();
const PORT = 3000;
const WALLET_ADDRESS = '0xfC74Aeb8eaCf185A4D1c4EC6a4A1aC60702E4785';

let startingBalance = null;
let lastTradeTime = 0;
let clobClient = null;

// ========== ДВУСТЕПЕННА CLOB ИНИЦИАЛИЗАЦИЯ ==========
async function initClob() {
    try {
        let privateKey = process.env.POLYMARKET_PRIVATE_KEY;
        if (!privateKey) throw new Error('Липсва POLYMARKET_PRIVATE_KEY');
        
        // Гарантираме, че ключът започва с 0x
        if (!privateKey.startsWith('0x')) privateKey = '0x' + privateKey;
        
        const account = privateKeyToAccount(privateKey);
        const signer = createWalletClient({ account, transport: http('https://polygon-rpc.com'), chain: polygon });
        console.log(`✅ Адрес: ${account.address}`);

        // СТЪПКА 1: Временен клиент за извличане на L2 credentials
        const tempClient = new ClobClient({ host: 'https://clob.polymarket.com', chainId: 137, signer });
        const apiCreds = await tempClient.createOrDeriveApiKey();
        console.log("✅ L2 credentials извлечени успешно");

        // СТЪПКА 2: Основен клиент с credentials
        clobClient = new ClobClient({ host: 'https://clob.polymarket.com', chainId: 137, signer, creds: apiCreds, signatureType: 3, funderAddress: account.address });
        console.log("✅ ClobClient v2 инициализиран - ГОТОВ ЗА РЕАЛНИ ОРДЕРИ");
        return true;
    } catch (error) {
        console.error('❌ CLOB грешка:', error.message);
        return false;
    }
}

// ========== ИЗПРАЩАНЕ НА РЕАЛЕН ОРДЕР ==========
async function executeTrade() {
    if (!clobClient || Date.now() - lastTradeTime < 60000) return;
    lastTradeTime = Date.now();
    
    try {
        const response = await clobClient.createAndPostMarketOrder(
            { tokenID: "71317238123731522030021395100684597673170796261859777545687942220367359305106", amount: 1.00, side: Side.BUY, orderType: OrderType.FOK },
            { tickSize: "0.01" },
            OrderType.FOK
        );
        console.log(`✅ РЕАЛЕН ОРДЕР ИЗПРАТЕН!`, response);
    } catch (error) {
        console.error('❌ Грешка при ордер:', error.message);
    }
}

app.get('/', (req, res) => res.send('HyperMeteo V4 - Работи'));
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 http://89.117.152.7:${PORT}`));

initClob().then(() => setInterval(executeTrade, 60000));
