const { ethers } = require('ethers');

// Polygon USDC адреси
const USDC_BRIDGED = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDC_NATIVE = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const RPC_URL = `https://polygon-mainnet.infura.io/v3/${process.env.INFURA_API_KEY || 'c025d1de40ac442abf02ba41bc9830a0'}`;

const USDC_ABI = ['function balanceOf(address account) view returns (uint256)'];

async function getRealUSDCBalance(walletAddress) {
    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        
        // Проверка на bridged USDC (USDC.e)
        const bridgedContract = new ethers.Contract(USDC_BRIDGED, USDC_ABI, provider);
        const bridgedBalance = await bridgedContract.balanceOf(walletAddress);
        const bridgedAmount = Number(ethers.formatUnits(bridgedBalance, 6));
        
        // Проверка на native USDC
        const nativeContract = new ethers.Contract(USDC_NATIVE, USDC_ABI, provider);
        const nativeBalance = await nativeContract.balanceOf(walletAddress);
        const nativeAmount = Number(ethers.formatUnits(nativeBalance, 6));
        
        // Вземаме който не е нула
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
