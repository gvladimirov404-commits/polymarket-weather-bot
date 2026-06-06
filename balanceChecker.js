const { ethers } = require('ethers');

const USDC_BRIDGED = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDC_NATIVE = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

async function getRealUSDCBalance(walletAddress) {
    try {
        const RPC_URL = `https://polygon-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`;
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const USDC_ABI = ['function balanceOf(address account) view returns (uint256)'];
        
        const bridgedContract = new ethers.Contract(USDC_BRIDGED, USDC_ABI, provider);
        const nativeContract = new ethers.Contract(USDC_NATIVE, USDC_ABI, provider);
        
        let balance = Number(ethers.formatUnits(await bridgedContract.balanceOf(walletAddress), 6));
        if (balance === 0) balance = Number(ethers.formatUnits(await nativeContract.balanceOf(walletAddress), 6));
        
        console.log(`💰 Баланс: ${balance.toFixed(4)} USDC`);
        return { success: true, balance };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = { getRealUSDCBalance };
