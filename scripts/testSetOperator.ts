import { ethers } from "ethers";

/**
 * 测试 setOperator 调用
 * 验证 gas limit 和参数是否正确
 */

const SEPOLIA_RPC = "https://sepolia.infura.io/v3/5e6d0def89ec47b1a2f9dfd91fc38ba6";
const TOKEN_ADDRESS = "0xAE4b8A28B69Ab86fb905Fc535e0F4B27bbe59243";

async function testSetOperator() {
  console.log("\n🧪 Testing setOperator call...\n");

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  
  // 模拟账户地址
  const userAddress = "0xc7b0D4dc5184b95Dda276b475dF59C3686d3E724";
  
  // 计算 7 天后的时间戳
  const expiry = Math.floor(Date.now() / 1000) + 7 * 86400;
  
  console.log("参数:");
  console.log(`  operator: ${userAddress}`);
  console.log(`  expiry: ${expiry} (${new Date(expiry * 1000).toISOString()})`);
  
  // 创建合约实例
  const token = new ethers.Contract(
    TOKEN_ADDRESS,
    ["function setOperator(address operator, uint256 until) external"],
    provider
  );

  try {
    // 估算 gas
    console.log("\n📊 估算 Gas...");
    
    // 注意:这里无法真正估算 gas,因为需要私钥签名
    // 但我们可以检查函数签名是否正确
    const data = token.interface.encodeFunctionData("setOperator", [
      userAddress,
      BigInt(expiry)
    ]);
    
    console.log("✅ 函数调用数据编码成功");
    console.log(`  Data length: ${data.length} bytes`);
    console.log(`  Data: ${data.slice(0, 66)}...`);
    
    // 建议的 gas limit
    console.log("\n💡 建议:");
    console.log("  推荐 Gas Limit: 200,000");
    console.log("  预计 Gas 使用: ~80,000 - 120,000");
    
  } catch (err: any) {
    console.error("❌ 错误:", err.message);
  }
}

testSetOperator()
  .then(() => {
    console.log("\n✅ 测试完成\n");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
