# 🚀 Sepolia 部署指南

## ✅ 部署前检查清单

### 1. 环境配置

确保已设置以下环境变量：

```bash
# 设置助记词（12个或24个单词）
npx hardhat vars set MNEMONIC "your twelve word mnemonic phrase goes here ..."

# 设置 Infura API Key
npx hardhat vars set INFURA_API_KEY "your_infura_api_key_here"

# 设置 Etherscan API Key（用于合约验证）
npx hardhat vars set ETHERSCAN_API_KEY "your_etherscan_api_key_here"
```

**获取 API Keys：**
- Infura: https://infura.io/
- Etherscan: https://etherscan.io/myapikey

### 2. 测试网 ETH

确保部署账户有足够的 Sepolia ETH：
- 至少需要：0.05 ETH（用于部署3个合约 + gas）
- 推荐：0.1 ETH

**获取测试网 ETH：**
- Sepolia Faucet 1: https://sepoliafaucet.com/
- Sepolia Faucet 2: https://www.alchemy.com/faucets/ethereum-sepolia
- Sepolia Faucet 3: https://faucet.quicknode.com/ethereum/sepolia

### 3. 本地测试

在部署前，确保所有测试通过：

```bash
npm test
```

**预期结果：**
- ✅ 69个测试通过
- ⏭️ 1个测试pending（Sepolia测试，正常）

---

## 📦 部署步骤

### 步骤 1：编译合约

```bash
npm run compile
```

### 步骤 2：部署到 Sepolia

```bash
npx hardhat deploy --network sepolia --tags BlindAuction
```

**部署顺序：**
1. MySecretToken (ERC7984 加密代币)
2. TokenExchange (代币兑换合约)
3. BlindAuction (主拍卖合约)

### 步骤 3：验证合约

部署成功后，在 Etherscan 上验证合约源代码：

```bash
# 替换 <ADDRESS> 为实际部署的地址

# 验证 MySecretToken
npx hardhat verify --network sepolia <TOKEN_ADDRESS> "Secret Auction Token" "SAT" "ipfs://QmBlindAuctionTokenMetadata"

# 验证 TokenExchange
npx hardhat verify --network sepolia <EXCHANGE_ADDRESS> <TOKEN_ADDRESS>

# 验证 BlindAuction
npx hardhat verify --network sepolia <AUCTION_ADDRESS> <TOKEN_ADDRESS>
```

---

## 🎯 部署后测试

### 1. 购买代币测试

```bash
npx hardhat console --network sepolia
```

```javascript
const exchange = await ethers.getContractAt("TokenExchange", "<EXCHANGE_ADDRESS>");
const tx = await exchange.buyTokens({ value: ethers.parseEther("0.1") });
await tx.wait();
console.log("✅ 购买代币成功");
```

### 2. 创建拍卖测试

```javascript
const auction = await ethers.getContractAt("BlindAuction", "<AUCTION_ADDRESS>");
const now = Math.floor(Date.now() / 1000);
const startTime = now + 300; // 5分钟后开始
const endTime = startTime + 3600; // 1小时后结束

const tx = await auction.createAuction(
  "QmTestAuction",
  startTime,
  endTime,
  { value: ethers.parseEther("0.01") }
);
await tx.wait();
console.log("✅ 创建拍卖成功");
```

### 3. 加密出价测试

```javascript
const fhevm = await import("hardhat").then(h => h.fhevm);
const [signer] = await ethers.getSigners();

// 授权拍卖合约
const token = await ethers.getContractAt("MySecretToken", "<TOKEN_ADDRESS>");
const oneYear = Math.floor(Date.now() / 1000) + 365 * 86400;
await token.setOperator("<AUCTION_ADDRESS>", oneYear);

// 等待拍卖开始...然后出价
const encryptedAmount = await fhevm
  .createEncryptedInput("<AUCTION_ADDRESS>", signer.address)
  .add64(100000n)
  .encrypt();

await auction.bid(0, encryptedAmount.handles[0], encryptedAmount.inputProof);
console.log("✅ 加密出价成功");
```

---

## 📊 合约信息

### MySecretToken (ERC7984)
- **名称**: Secret Auction Token
- **符号**: SAT
- **小数位数**: 6
- **功能**:
  - 加密余额存储
  - 加密转账
  - 加密授权

### TokenExchange
- **兑换比例**: 1 ETH = 1,000,000 SAT
- **功能**:
  - ETH 购买代币
  - 代币赎回 ETH
  - 储备金管理

### BlindAuction
- **上架费**: 0.01 ETH
- **押金**: 0.05 ETH (可退还)
- **功能**:
  - 创建拍卖
  - 加密出价（隐私保护）
  - 统一领取接口
  - 押金提取
  - 平局保护

---

## 🔐 安全特性

### 已实现的安全措施：
- ✅ 重入攻击防护 (ReentrancyGuard)
- ✅ 访问控制 (Ownable)
- ✅ 平局保护 (soldTotal 机制)
- ✅ 自定义错误（节省 gas）
- ✅ 时间检查修饰符
- ✅ FHE 加密隐私保护

### 已知设计决策：
- ⚠️ 所有出价者的押金都可退还（包括获胜者）
- ⚠️ 平台仅通过上架费（0.01 ETH）盈利
- ⚠️ 这是为了简化逻辑，避免 FHE 环境下判断获胜者的复杂性

---

## 📝 常见问题

### Q1: 部署失败怎么办？
**A:** 检查以下几点：
1. Sepolia ETH 余额是否充足
2. MNEMONIC 和 INFURA_API_KEY 是否正确设置
3. 网络连接是否正常
4. 查看错误日志获取详细信息

### Q2: 如何查看部署的合约地址？
**A:** 部署成功后，地址会显示在终端输出中。也可以在 `deployments/sepolia/` 目录下查看 JSON 文件。

### Q3: 验证合约失败怎么办？
**A:** 常见原因：
1. 等待区块确认（建议等待 5-10 个区块）
2. 确保构造函数参数顺序和类型正确
3. 检查 ETHERSCAN_API_KEY 是否有效

### Q4: 如何提取手续费？
**A:** 只有 Owner 可以调用：
```javascript
await auction.withdrawFees();
```

---

## 🎉 部署成功标志

部署成功后，你应该看到：
- ✅ 3个合约地址（Token, Exchange, Auction）
- ✅ 在 Sepolia Etherscan 上可以查看到合约
- ✅ 合约源代码已验证
- ✅ 可以成功调用合约函数

---

## 📞 支持

如有问题，请检查：
- 本项目的 README.md
- Hardhat 文档: https://hardhat.org/
- FHEVM 文档: https://docs.fhevm.io/
- 项目 GitHub Issues

---

**祝部署顺利！🚀**
