const { ethers } = require('ethers');

// Polygon USDC адреси
const USDC_BRIDGED = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDC_NATIVE = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

async function getRealUSDCBalance(walletAddress) {
    try {
        const apiKey = process.env.INFURA_API_KEY;
        if (!apiKey) {
            console.log('⚠️ Няма INFURA_API_KEY в .env');
            return { success: false, error: 'Missing INFURA_API_KEY', balance: 0 };
        }
        
        const RPC_URL = `https://polygon-mainnet.infura.io/v3/${apiKey}`;
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const USDC_ABI = ['function balanceOf(address account) view returns (uint256)'];
        
        const bridgedContract = new ethers.Contract(USDC_BRIDGED, USDC_ABI, provider);
        const bridgedBalance = await bridgedContract.balanceOf(walletAddress);
        const bridgedAmount = Number(ethers.formatUnits(bridgedBalance, 6));
        
        const nativeContract = new ethers.Contract(USDC_NATIVE, USDC_ABI, provider);
        const nativeBalance = await nativeContract.balanceOf(walletAddress);
        const nativeAmount = Number(ethers.formatUnits(nativeBalance, 6));
        
        let balance = 0;
        let usedToken = '';
        
        if (bridgedAmount > 0) {
            balance = bridgedAmount;
            usedToken = 'USDC.e (bridged)';
        } else if (nativeAmount > 0) {
            balance = nativeAmount;
            usedToken = 'USDC (native)';
        }
        
        console.log(`✅ RPC успешен | ${usedToken || 'няма USDC'}: ${balance.toFixed(4)}`);
        return { success: true, balance, usedToken };
        
    } catch (error) {
        console.error('❌ RPC грешка:', error.message);
        return { success: false, error: error.message, balance: 0 };
    }
}

module.exports = { getRealUSDCBalance };
