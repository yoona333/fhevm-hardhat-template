# 🚀 BlindAuction 前端速查表

> 快速参考常用代码片段

---

## 📦 合约地址（Sepolia）

```javascript
const CONTRACTS = {
  Token: "0x168ecd6465D5f6A479ef1cF7bc7B23748eD6e0c7",
  Exchange: "0x420d4172D8153cB3fB76b21Ffd0b482F62112f7C",
  Auction: "0xb77038085AA13334C57278CD66dD10Ac7F4171b9",
};
```

---

## ⚡ 快速开始

### 1. 安装依赖

```bash
npm install ethers@6.16.0 fhevmjs@0.6.0-1
```

### 2. 初始化 FHEVM

```javascript
import { createInstance } from "fhevmjs";

let fhevm = null;

async function init() {
  fhevm = await createInstance({
    chainId: 11155111,
    networkUrl: "https://sepolia.infura.io/v3/YOUR_KEY",
    gatewayUrl: "https://gateway.sepolia.zama.ai",
  });
}
```

### 3. 连接钱包

```javascript
import { BrowserProvider } from "ethers";

const provider = new BrowserProvider(window.ethereum);
const signer = await provider.getSigner();
const address = await signer.getAddress();
```

---

## 📝 常用代码片段

### 购买代币

```javascript
import { Contract, parseEther } from "ethers";

const EXCHANGE_ABI = ["function buyTokens() payable"];
const exchange = new Contract(CONTRACTS.Exchange, EXCHANGE_ABI, signer);

// 用 0.1 ETH 购买代币
await exchange.buyTokens({ value: parseEther("0.1") });
```

---

### 授权拍卖合约

```javascript
const TOKEN_ABI = ["function setOperator(address operator, uint256 expiry)"];
const token = new Contract(CONTRACTS.Token, TOKEN_ABI, signer);

const oneYear = Math.floor(Date.now() / 1000) + 365 * 86400;
await token.setOperator(CONTRACTS.Auction, oneYear);
```

---

### 创建拍卖

```javascript
const AUCTION_ABI = [
  "function createAuction(string metadataCID, uint256 startTime, uint256 endTime) payable"
];
const auction = new Contract(CONTRACTS.Auction, AUCTION_ABI, signer);

const now = Math.floor(Date.now() / 1000);
const startTime = now + 300; // 5分钟后
const endTime = startTime + 3600; // 1小时

await auction.createAuction("QmYourCID", startTime, endTime, {
  value: parseEther("0.01") // 上架费
});
```

---

### 加密出价（⭐ 核心）

```javascript
// 1. 加密金额
const amount = 100000n; // 必须用 BigInt
const input = fhevm.createEncryptedInput(CONTRACTS.Auction, userAddress);
input.add64(amount);
const encrypted = await input.encrypt();

// 2. 提交出价
const AUCTION_ABI = [
  "function bid(uint256 auctionId, bytes encryptedAmount, bytes inputProof)"
];
const auction = new Contract(CONTRACTS.Auction, AUCTION_ABI, signer);

await auction.bid(
  auctionId,
  encrypted.handles[0],
  encrypted.inputProof
);
```

---

### 查看余额（加密）

```javascript
const TOKEN_ABI = [
  "function confidentialBalanceOf(address account) view returns (bytes)"
];
const token = new Contract(CONTRACTS.Token, TOKEN_ABI, signer);

// 1. 获取加密余额
const encryptedBalance = await token.confidentialBalanceOf(userAddress);

// 2. 解密（使用 fhevmjs 的 helper）
const balance = await fhevm.decrypt(encryptedBalance, {
  contractAddress: CONTRACTS.Token,
  userAddress,
  signer,
});

console.log("余额:", balance); // 1000000n
```

---

### 领取拍卖结果

```javascript
const AUCTION_ABI = ["function claim(uint256 auctionId) payable"];
const auction = new Contract(CONTRACTS.Auction, AUCTION_ABI, signer);

await auction.claim(auctionId, {
  value: parseEther("0.05") // 押金
});
```

---

### 提取押金

```javascript
const AUCTION_ABI = ["function withdrawStake(uint256 auctionId)"];
const auction = new Contract(CONTRACTS.Auction, AUCTION_ABI, signer);

await auction.withdrawStake(auctionId);
```

---

### 查询拍卖详情

```javascript
const AUCTION_ABI = [
  "function getAuction(uint256 auctionId) view returns (address beneficiary, string metadataCID, uint256 startTime, uint256 endTime)"
];
const auction = new Contract(CONTRACTS.Auction, AUCTION_ABI, provider);

const details = await auction.getAuction(auctionId);

console.log({
  seller: details.beneficiary,
  metadata: details.metadataCID,
  startTime: new Date(Number(details.startTime) * 1000),
  endTime: new Date(Number(details.endTime) * 1000),
});
```

---

### 查询我的拍卖

```javascript
const AUCTION_ABI = [
  "function getUserBidAuctions(address user) view returns (uint256[])",
  "function getUserCreatedAuctions(address user) view returns (uint256[])"
];
const auction = new Contract(CONTRACTS.Auction, AUCTION_ABI, provider);

// 我出价的拍卖
const myBids = await auction.getUserBidAuctions(userAddress);

// 我创建的拍卖
const myAuctions = await auction.getUserCreatedAuctions(userAddress);
```

---

## 🎯 完整流程（Copy & Paste）

### 用户购买代币 + 出价

```javascript
import { BrowserProvider, Contract, parseEther } from "ethers";
import { createInstance } from "fhevmjs";

// 配置
const AUCTION_ADDRESS = "0xb77038085AA13334C57278CD66dD10Ac7F4171b9";
const TOKEN_ADDRESS = "0x168ecd6465D5f6A479ef1cF7bc7B23748eD6e0c7";
const EXCHANGE_ADDRESS = "0x420d4172D8153cB3fB76b21Ffd0b482F62112f7C";

async function completeBidFlow() {
  // 1. 连接钱包
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const userAddress = await signer.getAddress();

  // 2. 初始化 FHEVM
  const fhevm = await createInstance({
    chainId: 11155111,
    networkUrl: "https://sepolia.infura.io/v3/YOUR_KEY",
    gatewayUrl: "https://gateway.sepolia.zama.ai",
  });

  // 3. 购买代币
  const exchange = new Contract(
    EXCHANGE_ADDRESS,
    ["function buyTokens() payable"],
    signer
  );
  await exchange.buyTokens({ value: parseEther("0.1") });

  // 4. 授权拍卖合约
  const token = new Contract(
    TOKEN_ADDRESS,
    ["function setOperator(address operator, uint256 expiry)"],
    signer
  );
  const oneYear = Math.floor(Date.now() / 1000) + 365 * 86400;
  await token.setOperator(AUCTION_ADDRESS, oneYear);

  // 5. 加密出价
  const bidAmount = 50000n;
  const input = fhevm.createEncryptedInput(AUCTION_ADDRESS, userAddress);
  input.add64(bidAmount);
  const encrypted = await input.encrypt();

  // 6. 提交出价
  const auction = new Contract(
    AUCTION_ADDRESS,
    ["function bid(uint256 auctionId, bytes encryptedAmount, bytes inputProof)"],
    signer
  );
  await auction.bid(0, encrypted.handles[0], encrypted.inputProof);

  console.log("✅ 出价成功！");
}
```

---

## 🔍 调试工具

### 检查钱包和网络

```javascript
async function checkWallet() {
  if (!window.ethereum) {
    alert("请安装 MetaMask");
    return;
  }

  const provider = new BrowserProvider(window.ethereum);
  const network = await provider.getNetwork();
  const signer = await provider.getSigner();
  const balance = await provider.getBalance(signer.address);

  console.log({
    chainId: Number(network.chainId),
    isSepoliaNetwork: Number(network.chainId) === 11155111,
    address: signer.address,
    balance: parseFloat(formatEther(balance)).toFixed(4) + " ETH",
  });
}
```

### 监听合约事件

```javascript
// 实时监听新拍卖
auction.on("AuctionCreated", (auctionId, beneficiary, metadataCID) => {
  console.log("🎉 新拍卖:", {
    id: auctionId.toString(),
    seller: beneficiary,
    metadata: metadataCID,
  });
});

// 实时监听出价
auction.on("BidPlaced", (auctionId, bidder) => {
  console.log("💰 新出价:", {
    auctionId: auctionId.toString(),
    bidder,
  });
});
```

---

## ❌ 常见错误

### Error: "FHEVM not initialized"

```javascript
// ❌ 错误：没有初始化
const fhevm = getFhevmInstance(); // 报错

// ✅ 正确：先初始化
await initFhevm();
const fhevm = getFhevmInstance(); // 成功
```

### Error: "User denied transaction"

```javascript
// 用户拒绝签名，捕获错误
try {
  await contract.someFunction();
} catch (error) {
  if (error.code === 4001) {
    alert("用户取消了交易");
  }
}
```

### Error: "Insufficient funds"

```javascript
// 检查余额
const balance = await provider.getBalance(userAddress);
if (balance < parseEther("0.1")) {
  alert("余额不足，请充值");
}
```

### Error: "Invalid encrypted input"

```javascript
// ❌ 错误：使用普通数字
input.add64(100000); // 报错

// ✅ 正确：使用 BigInt
input.add64(100000n); // 成功
```

---

## 💡 最佳实践

### 1. 错误处理

```javascript
async function safeCall(fn, errorMessage) {
  try {
    await fn();
    return { success: true };
  } catch (error) {
    console.error(errorMessage, error);
    return { success: false, error: error.message };
  }
}

// 使用
const result = await safeCall(
  () => auction.bid(auctionId, encrypted.handles[0], encrypted.inputProof),
  "出价失败"
);

if (result.success) {
  alert("出价成功！");
} else {
  alert("出价失败: " + result.error);
}
```

### 2. Loading 状态

```javascript
const [loading, setLoading] = useState(false);

async function handleBid() {
  setLoading(true);
  try {
    await auction.bid(...);
  } finally {
    setLoading(false); // 确保无论成功失败都恢复
  }
}
```

### 3. 交易确认提示

```javascript
const tx = await auction.bid(...);
console.log("📤 交易已发送:", tx.hash);

alert("交易已发送，等待确认...");

const receipt = await tx.wait();
console.log("✅ 交易已确认:", receipt.hash);

alert("交易成功！");
```

---

## 🔗 有用的链接

- 📖 [完整文档](./FRONTEND_INTEGRATION.md)
- 🔗 [MySecretToken 合约](https://sepolia.etherscan.io/address/0x168ecd6465D5f6A479ef1cF7bc7B23748eD6e0c7#code)
- 🔗 [TokenExchange 合约](https://sepolia.etherscan.io/address/0x420d4172D8153cB3fB76b21Ffd0b482F62112f7C#code)
- 🔗 [BlindAuction 合约](https://sepolia.etherscan.io/address/0xb77038085AA13334C57278CD66dD10Ac7F4171b9#code)
- 💧 [Sepolia 水龙头](https://sepoliafaucet.com/)

---

**保存此文档以便快速查找！📌**
