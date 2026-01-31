const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log("\n" + "=".repeat(60));
  console.log("📋 部署账户信息");
  console.log("=".repeat(60));
  console.log(`地址: ${deployer.address}`);
  console.log(`余额: ${hre.ethers.formatEther(balance)} ETH`);
  console.log("=".repeat(60) + "\n");

  if (balance < hre.ethers.parseEther("0.05")) {
    console.log("⚠️  警告：余额不足！");
    console.log("   推荐余额：至少 0.05 ETH");
    console.log("   当前余额：" + hre.ethers.formatEther(balance) + " ETH");
    console.log("\n   获取测试 ETH：");
    console.log("   - https://sepoliafaucet.com/");
    console.log("   - https://www.alchemy.com/faucets/ethereum-sepolia\n");
  } else {
    console.log("✅ 余额充足，可以开始部署！\n");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
