const { ethers } = require("hardhat");

async function main() {
  // 检查最近的交易
  const address = "0xc7b0D4dc5184b95Dda276b475dF59C3686d3E724";
  
  const provider = new ethers.JsonRpcProvider(
    "https://sepolia.infura.io/v3/5e6d0def89ec47b1a2f9dfd91fc38ba6"
  );
  
  console.log("Checking account:", address);
  console.log("\n=== Recent Activity ===");
  
  // 获取交易数量
  const txCount = await provider.getTransactionCount(address);
  console.log("Transaction count (nonce):", txCount);
  
  // 获取最新区块
  const blockNumber = await provider.getBlockNumber();
  console.log("Latest block:", blockNumber);
  
  // 检查 pending 交易
  console.log("\n=== Checking Pending Transactions ===");
  const pendingTxCount = await provider.getTransactionCount(address, "pending");
  console.log("Pending transaction count:", pendingTxCount);
  
  if (pendingTxCount > txCount) {
    console.log(`⚠️ ${pendingTxCount - txCount} transaction(s) pending!`);
  } else {
    console.log("✅ No pending transactions");
  }
}

main().catch(console.error);
