/**
 * 自动更新前端配置文件中的合约地址
 *
 * 用法: node scripts/updateFrontendConfig.js <network>
 * 示例: node scripts/updateFrontendConfig.js sepolia
 */

const fs = require('fs');
const path = require('path');

// 获取网络参数
const network = process.argv[2] || 'sepolia';

console.log(`\n🔄 更新前端配置文件 (网络: ${network})...\n`);

// 部署文件路径
const deploymentsPath = path.join(__dirname, '..', 'deployments', network);
const frontendConfigPath = path.join(__dirname, '..', '..', 'zh-blindauction', 'src', 'config', 'contracts.ts');

// 检查部署文件是否存在
if (!fs.existsSync(deploymentsPath)) {
  console.error(`❌ 错误: 找不到部署文件目录: ${deploymentsPath}`);
  console.error(`   请先运行: npx hardhat deploy --network ${network}`);
  process.exit(1);
}

// 读取合约地址
try {
  const mySecretTokenDeployment = JSON.parse(
    fs.readFileSync(path.join(deploymentsPath, 'MySecretToken.json'), 'utf8')
  );
  const tokenExchangeDeployment = JSON.parse(
    fs.readFileSync(path.join(deploymentsPath, 'TokenExchange.json'), 'utf8')
  );
  const blindAuctionDeployment = JSON.parse(
    fs.readFileSync(path.join(deploymentsPath, 'BlindAuction.json'), 'utf8')
  );

  const addresses = {
    mySecretToken: mySecretTokenDeployment.address,
    tokenExchange: tokenExchangeDeployment.address,
    blindAuction: blindAuctionDeployment.address,
  };

  console.log('📋 部署地址:');
  console.log(`   MySecretToken:  ${addresses.mySecretToken}`);
  console.log(`   TokenExchange:  ${addresses.tokenExchange}`);
  console.log(`   BlindAuction:   ${addresses.blindAuction}\n`);

  // 检查前端配置文件是否存在
  if (!fs.existsSync(frontendConfigPath)) {
    console.error(`❌ 错误: 找不到前端配置文件: ${frontendConfigPath}`);
    process.exit(1);
  }

  // 读取前端配置文件
  let configContent = fs.readFileSync(frontendConfigPath, 'utf8');

  // 根据网络ID替换地址
  const chainId = network === 'sepolia' ? '11155111' : '31337';

  // 替换 MySecretToken 地址
  configContent = configContent.replace(
    new RegExp(`(${chainId}:\\s*{[^}]*mySecretToken:\\s*")[^"]+(")`),
    `$1${addresses.mySecretToken}$2`
  );

  // 替换 TokenExchange 地址
  configContent = configContent.replace(
    new RegExp(`(${chainId}:\\s*{[^}]*tokenExchange:\\s*")[^"]+(")`),
    `$1${addresses.tokenExchange}$2`
  );

  // 替换 BlindAuction 地址
  configContent = configContent.replace(
    new RegExp(`(${chainId}:\\s*{[^}]*blindAuction:\\s*")[^"]+(")`),
    `$1${addresses.blindAuction}$2`
  );

  // 写回文件
  fs.writeFileSync(frontendConfigPath, configContent, 'utf8');

  console.log('✅ 前端配置文件已更新!');
  console.log(`   文件路径: ${frontendConfigPath}\n`);

  console.log('📝 下一步:');
  console.log('   1. 在前端项目中重启开发服务器');
  console.log('   2. 验证合约地址是否正确');
  console.log('   3. 开始测试功能\n');

} catch (error) {
  console.error('❌ 更新配置失败:', error.message);
  process.exit(1);
}
