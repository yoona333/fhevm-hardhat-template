const { ethers } = require("ethers");

async function main() {
  const provider = new ethers.JsonRpcProvider(
    "https://sepolia.infura.io/v3/5e6d0def89ec47b1a2f9dfd91fc38ba6"
  );
  
  const tokenAddress = "0xAE4b8A28B69Ab86fb905Fc535e0F4B27bbe59243";
  const userAddress = "0xc7b0D4dc5184b95Dda276b475dF59C3686d3E724";
  
  const abi = [
    "function setOperator(address operator, uint256 expiry) external",
    "function owner() external view returns (address)",
  ];
  
  const token = new ethers.Contract(tokenAddress, abi, provider);
  
  console.log("Token contract:", tokenAddress);
  console.log("User address:", userAddress);
  
  // 检查 owner
  const owner = await token.owner();
  console.log("Token owner:", owner);
  
  // 计算 expiry
  const expiry = Math.floor(Date.now() / 1000) + 7 * 86400;
  console.log("Expiry timestamp:", expiry);
  console.log("Expiry date:", new Date(expiry * 1000).toISOString());
  
  // 估算 gas
  try {
    const gasEstimate = await token.setOperator.estimateGas(userAddress, expiry);
    console.log("Estimated gas:", gasEstimate.toString());
  } catch (err) {
    console.error("Gas estimation failed:", err.message);
  }
}

main().catch(console.error);
