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
  console.log("3️⃣ 部署 BlindAuction (NFT 拍卖合约)...");

  const auction = await deploy("BlindAuction", {
    from: deployer,
    args: [
      token.address,
      "BlindAuction NFT", // NFT 名称
      "BAFT",             // NFT 符号
      2                   // 出价手续费比例（2%），可按需调整
    ],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`   ✅ BlindAuction 部署成功: ${auction.address}`);
  console.log(`   📊 NFT 名称: BlindAuction NFT (BANFT)`);
  console.log(`   📊 上架费: 0.01 ETH`);
  console.log(`   📊 押金: 0.05 ETH (可退还)\n`);

  // ============ 第四步：给测试账户铸造代币（在转移所有权之前）============
  console.log("4️⃣ 给测试账户铸造 SAT 代币（仅限本地测试）...");

  const MySecretToken = await hre.ethers.getContractAt("MySecretToken", token.address);

  // 检查是否是本地网络
  const network = hre.network.name;
  if (network === "hardhat" || network === "localhost") {
    const accounts = await hre.ethers.getSigners();

    // 准备接收者地址数组（账户 0-9）
    const recipients: string[] = [];
    for (let i = 0; i < 10; i++) {
      recipients.push(accounts[i].address);
    }

    // 每人铸造 100,000,000 SAT (相当于 100 ETH 价值)
    const mintAmount = 100_000_000;

    console.log(`   💰 批量铸造: 10 个账户，每人 ${mintAmount.toLocaleString()} SAT`);

    // 设置 deployer 为 minter
    console.log(`   🔄 设置 deployer 为 minter...`);
    const tx1 = await MySecretToken.setMinter(deployer);
    await tx1.wait();

    // 批量铸造代币
    console.log(`   ⚙️ 批量铸造代币...`);
    const tx2 = await MySecretToken.mintBatch(recipients, mintAmount);
    await tx2.wait();

    console.log(`   ✅ 所有测试账户代币铸造完成\n`);
  }

  // ============ 第五步：配置合约权限 ============
  console.log("5️⃣ 配置合约权限...");

  // 🔥 关键修复：设置 TokenExchange 为 minter（允许它铸造代币）
  // 这样用户可以通过 TokenExchange.buyTokens() 购买 SAT 代币
  console.log(`   🔄 设置 TokenExchange 为 MySecretToken 的 minter...`);
  const txMinter = await MySecretToken.setMinter(exchange.address);
  await txMinter.wait();
  console.log(`   ✅ TokenExchange 已设置为 minter（现在可以铸造代币）\n`);

  // 注意：保留 owner 权限，因为需要 owner 来管理 minter
  // 如果需要，可以单独转移所有权
  // console.log(`   🔄 将 MySecretToken 所有权转移给 TokenExchange...`);
  // const txOwner = await MySecretToken.transferOwnership(exchange.address);
  // await txOwner.wait();
  // console.log(`   ✅ 所有权转移成功\n`);

  if (network === "hardhat" || network === "localhost") {
    // 验证余额（可选，加密余额无法直接查看）
    console.log("   📊 账户列表:");
    const accounts = await hre.ethers.getSigners();
    for (let i = 0; i < 3; i++) {
      console.log(`      账户 ${i}: ${accounts[i].address.slice(0, 10)}...`);
    }
    console.log(`      ... 共 10 个账户\n`);
  }

  // ============ 第六步：部署总结 ============

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

  console.log("=".repeat(80) + "\n");
};

export default func;
func.id = "deploy_blind_auction_system";
func.tags = ["BlindAuction", "MySecretToken", "TokenExchange"];
