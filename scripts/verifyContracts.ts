import { ethers } from "ethers";

/**
 * 验证合约部署状态的工具脚本
 * 用于检查 Sepolia 测试网上的合约是否正确部署
 */

const SEPOLIA_RPC = "https://sepolia.infura.io/v3/5e6d0def89ec47b1a2f9dfd91fc38ba6";

const CONTRACT_ADDRESSES = {
  tokenExchange: "0xE1cD84947a301805229A1dE84B4Ca292600Ef0C6",
  mySecretToken: "0xAE4b8A28B69Ab86fb905Fc535e0F4B27bbe59243",
  blindAuction: "0x88C7976536790fB3918058a219CeD80093AeCEC9",
};

async function verifyContract(
  name: string,
  address: string,
  provider: ethers.JsonRpcProvider
) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📋 验证合约: ${name}`);
  console.log(`📍 地址: ${address}`);
  console.log("=".repeat(60));

  try {
    // 检查合约代码
    const code = await provider.getCode(address);
    
    if (code === "0x" || code === "0x0") {
      console.log("❌ 合约未部署！代码为空。");
      return false;
    }
    
    console.log(`✅ 合约已部署 (字节码长度: ${code.length - 2} 字节)`);

    // 检查合约余额
    const balance = await provider.getBalance(address);
    console.log(`💰 合约 ETH 余额: ${ethers.formatEther(balance)} ETH`);

    // 尝试调用基本函数
    try {
      const contract = new ethers.Contract(
        address,
        ["function owner() view returns (address)"],
        provider
      );
      const owner = await contract.owner();
      console.log(`👤 合约 Owner: ${owner}`);
    } catch (err) {
      console.log("⚠️ 无法读取 owner (可能合约没有此函数)");
    }

    // 如果是 MySecretToken，检查特殊函数
    if (name === "MySecretToken") {
      try {
        const token = new ethers.Contract(
          address,
          [
            "function confidentialBalanceOf(address account) view returns (bytes32)",
            "function minter() view returns (address)",
          ],
          provider
        );

        // 测试账户
        const testAddress = "0xc7b0D4dc5184b95Dda276b475dF59C3686d3E724";
        
        console.log(`\n🔍 测试 confidentialBalanceOf(${testAddress.slice(0, 10)}...):`);
        
        try {
          const handle = await token.confidentialBalanceOf(testAddress);
          console.log(`   ✅ 成功返回: ${handle}`);
          
          if (handle === "0x0000000000000000000000000000000000000000000000000000000000000000") {
            console.log("   ℹ️ 余额为 0 (新账户或未铸造)");
          }
        } catch (err: any) {
          console.log(`   ❌ 调用失败: ${err.message}`);
          return false;
        }

        try {
          const minter = await token.minter();
          console.log(`\n🔧 Minter 地址: ${minter}`);
        } catch (err) {
          console.log("\n⚠️ 无法读取 minter");
        }
      } catch (err: any) {
        console.log(`❌ 合约接口测试失败: ${err.message}`);
        return false;
      }
    }

    // 如果是 TokenExchange，检查汇率
    if (name === "TokenExchange") {
      try {
        const exchange = new ethers.Contract(
          address,
          [
            "function getExchangeRate() view returns (uint256)",
            "function token() view returns (address)",
          ],
          provider
        );

        const rate = await exchange.getExchangeRate();
        console.log(`💱 兑换汇率: 1 ETH = ${rate.toString()} SAT`);

        const tokenAddr = await exchange.token();
        console.log(`🪙 绑定的 Token 地址: ${tokenAddr}`);

        if (tokenAddr.toLowerCase() !== CONTRACT_ADDRESSES.mySecretToken.toLowerCase()) {
          console.log(`⚠️ TokenExchange 绑定的 Token 地址不匹配!`);
          console.log(`   预期: ${CONTRACT_ADDRESSES.mySecretToken}`);
          console.log(`   实际: ${tokenAddr}`);
        }
      } catch (err: any) {
        console.log(`❌ TokenExchange 接口测试失败: ${err.message}`);
        return false;
      }
    }

    console.log("\n✅ 合约验证通过\n");
    return true;
  } catch (error: any) {
    console.log(`❌ 验证失败: ${error.message}\n`);
    return false;
  }
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🔍 BlindAuction 合约验证工具");
  console.log("   Network: Sepolia Testnet");
  console.log("=".repeat(80));

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);

  // 检查网络连接
  try {
    const network = await provider.getNetwork();
    console.log(`\n✅ 已连接到网络: ${network.name} (Chain ID: ${network.chainId})`);
    
    const blockNumber = await provider.getBlockNumber();
    console.log(`📦 当前区块高度: ${blockNumber}`);
  } catch (err: any) {
    console.log(`\n❌ 无法连接到 Sepolia 网络: ${err.message}`);
    process.exit(1);
  }

  // 验证所有合约
  const results = {
    mySecretToken: false,
    tokenExchange: false,
    blindAuction: false,
  };

  results.mySecretToken = await verifyContract(
    "MySecretToken",
    CONTRACT_ADDRESSES.mySecretToken,
    provider
  );

  results.tokenExchange = await verifyContract(
    "TokenExchange",
    CONTRACT_ADDRESSES.tokenExchange,
    provider
  );

  results.blindAuction = await verifyContract(
    "BlindAuction",
    CONTRACT_ADDRESSES.blindAuction,
    provider
  );

  // 总结
  console.log("\n" + "=".repeat(80));
  console.log("📊 验证结果汇总");
  console.log("=".repeat(80));
  console.log(`MySecretToken:   ${results.mySecretToken ? "✅ 通过" : "❌ 失败"}`);
  console.log(`TokenExchange:   ${results.tokenExchange ? "✅ 通过" : "❌ 失败"}`);
  console.log(`BlindAuction:    ${results.blindAuction ? "✅ 通过" : "❌ 失败"}`);

  const allPassed = Object.values(results).every((r) => r);
  
  if (allPassed) {
    console.log("\n🎉 所有合约验证通过！");
  } else {
    console.log("\n⚠️ 部分合约验证失败，请检查部署状态。");
    console.log("\n💡 建议:");
    console.log("   1. 确认合约已在 Sepolia 测试网上部署");
    console.log("   2. 检查合约地址是否正确");
    console.log("   3. 如需重新部署，运行: npx hardhat deploy --network sepolia");
    console.log("   4. 部署后更新 src/config/contracts.ts 中的地址");
  }

  console.log("\n" + "=".repeat(80) + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
