const { ethers } = require('ethers');

// USDC на Polygon Mainnet
const USDC_ADDRESS =  '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; 
const RPC_URL = 'https://polygon.llamarpc.com';  // Надежден публичен RPC

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
