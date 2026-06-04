const { ethers } = require('ethers');

// USDC на Polygon Mainnet
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const RPC_URL = 'https://polygon-rpc.com';

const USDC_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

async function getRealUSDCBalance(walletAddress) {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
    
    const decimals = await usdcContract.decimals();
    const rawBalance = await usdcContract.balanceOf(walletAddress);
    const balance = Number(ethers.formatUnits(rawBalance, decimals));
    
    return { success: true, balance, decimals };
  } catch (error) {
    console.error('RPC грешка:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { getRealUSDCBalance };
