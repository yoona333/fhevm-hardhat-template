import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

/**
 * 部署 BlindAuction 系统的完整流程
 *
 * 部署顺序：
 * 1. MySecretToken (ERC7984 加密代币)
 * 2. TokenExchange (代币兑换合约)
 * 3. BlindAuction (主拍卖合约)
 *
 * 部署后操作：
 * - 将 MySecretToken 的所有权转移给 TokenExchange
 */

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("\n" + "=".repeat(80));
  console.log("🚀 开始部署 BlindAuction 系统");
  console.log("=".repeat(80));
  console.log(`\n📝 部署账户: ${deployer}\n`);

  // ============ 第一步：部署 MySecretToken ============
  console.log("1️⃣ 部署 MySecretToken (ERC7984 加密代币)...");

  const token = await deploy("MySecretToken", {
    from: deployer,
    args: [
      "Secret Auction Token", // 代币名称
      "SAT",                  // 代币符号
      "ipfs://QmBlindAuctionTokenMetadata" // IPFS 元数据 CID
    ],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`   ✅ MySecretToken 部署成功: ${token.address}`);
  console.log(`   📊 代币名称: Secret Auction Token (SAT)`);
  console.log(`   📊 小数位数: 6\n`);

  // ============ 第二步：部署 TokenExchange ============
  console.log("2️⃣ 部署 TokenExchange (代币兑换合约)...");

  const exchange = await deploy("TokenExchange", {
    from: deployer,
    args: [token.address],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`   ✅ TokenExchange 部署成功: ${exchange.address}`);
  console.log(`   📊 兑换比例: 1 ETH = 1,000,000 SAT\n`);

  // ============ 第三步：部署 BlindAuction ============
  console.log("3️⃣ 部署 BlindAuction (主拍卖合约)...");

  const auction = await deploy("BlindAuction", {
    from: deployer,
    args: [token.address],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`   ✅ BlindAuction 部署成功: ${auction.address}`);
  console.log(`   📊 上架费: 0.01 ETH`);
  console.log(`   📊 押金: 0.05 ETH (可退还)\n`);

  // ============ 第四步：转移代币所有权 ============
  console.log("4️⃣ 配置合约权限...");

  const MySecretToken = await hre.ethers.getContractAt("MySecretToken", token.address);

  console.log(`   🔄 将 MySecretToken 所有权转移给 TokenExchange...`);
  const tx = await MySecretToken.transferOwnership(exchange.address);
  await tx.wait();

  console.log(`   ✅ 所有权转移成功\n`);

  // ============ 部署总结 ============
  console.log("=".repeat(80));
  console.log("🎉 BlindAuction 系统部署完成！");
  console.log("=".repeat(80));
  console.log("\n📋 部署地址汇总:");
  console.log(`   MySecretToken:   ${token.address}`);
  console.log(`   TokenExchange:   ${exchange.address}`);
  console.log(`   BlindAuction:    ${auction.address}`);

  console.log("\n📝 后续步骤:");
  console.log("   1. 在 Etherscan 上验证合约:");
  console.log(`      npx hardhat verify --network sepolia ${token.address} "Secret Auction Token" "SAT" "ipfs://QmBlindAuctionTokenMetadata"`);
  console.log(`      npx hardhat verify --network sepolia ${exchange.address} ${token.address}`);
  console.log(`      npx hardhat verify --network sepolia ${auction.address} ${token.address}`);

  console.log("\n   2. 用户可以开始使用:");
  console.log("      - 购买代币: TokenExchange.buyTokens()");
  console.log("      - 创建拍卖: BlindAuction.createAuction()");
  console.log("      - 加密出价: BlindAuction.bid()");

  console.log("\n   3. Owner 可以提取手续费:");
  console.log("      - BlindAuction.withdrawFees()");

  console.log("\n=".repeat(80) + "\n");
};

export default func;
func.id = "deploy_blind_auction_system";
func.tags = ["BlindAuction", "MySecretToken", "TokenExchange"];
