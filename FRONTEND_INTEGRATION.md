# 🎨 BlindAuction 前端对接文档

> 📝 **目标读者**: 前端开发工程师（React/Vue/原生JS均可）
> 🎯 **目标**: 一次性完成对接，无需反复调试
> ⏱️ **预计时间**: 2-3小时

---

## 📋 目录

1. [快速开始](#1-快速开始)
2. [环境配置](#2-环境配置)
3. [核心概念](#3-核心概念)
4. [FHEVM 加解密详解](#4-fhevm-加解密详解)
5. [合约交互完整流程](#5-合约交互完整流程)
6. [代码示例](#6-代码示例)
7. [常见问题](#7-常见问题)
8. [调试技巧](#8-调试技巧)

---

## 1. 快速开始

### 1.1 合约地址（Sepolia 测试网）

```javascript
const CONTRACTS = {
  MySecretToken: "0x168ecd6465D5f6A479ef1cF7bc7B23748eD6e0c7",
  TokenExchange: "0x420d4172D8153cB3fB76b21Ffd0b482F62112f7C",
  BlindAuction: "0xb77038085AA13334C57278CD66dD10Ac7F4171b9",
};

const NETWORK = {
  chainId: 11155111, // Sepolia
  name: "sepolia",
  rpcUrl: "https://sepolia.infura.io/v3/YOUR_INFURA_KEY",
};
```

### 1.2 业务流程概览

```
用户注册/登录
    ↓
购买代币 (ETH → SAT)
    ↓
授权拍卖合约
    ↓
参与拍卖
    ├─ 卖家: 创建拍卖
    └─ 买家: 加密出价
    ↓
拍卖结束
    ↓
领取结果
    ├─ 获胜者: 代币转给卖家
    └─ 败者: 代币退还
    ↓
提取押金
```

---

## 2. 环境配置

### 2.1 安装依赖

```bash
npm install ethers@6.16.0 fhevmjs@0.6.0-1
```

**重要版本说明：**
- `ethers`: 必须使用 v6.x（不要用 v5）
- `fhevmjs`: FHEVM 的 JavaScript SDK

### 2.2 项目结构建议

```
src/
├── utils/
│   ├── contracts.js       # 合约地址和 ABI
│   ├── fhevm.js          # FHEVM 加解密工具
│   └── wallet.js         # 钱包连接工具
├── hooks/
│   ├── useWallet.js      # 钱包连接 Hook
│   └── useAuction.js     # 拍卖逻辑 Hook
└── components/
    ├── BuyTokens.jsx     # 购买代币组件
    ├── CreateAuction.jsx # 创建拍卖组件
    └── PlaceBid.jsx      # 出价组件
```

### 2.3 环境变量配置

创建 `.env` 文件：

```env
VITE_SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
VITE_TOKEN_ADDRESS=0x168ecd6465D5f6A479ef1cF7bc7B23748eD6e0c7
VITE_EXCHANGE_ADDRESS=0x420d4172D8153cB3fB76b21Ffd0b482F62112f7C
VITE_AUCTION_ADDRESS=0xb77038085AA13334C57278CD66dD10Ac7F4171b9
```

---

## 3. 核心概念

### 3.1 什么是 FHEVM？

**FHEVM = Fully Homomorphic Encryption Virtual Machine（全同态加密虚拟机）**

简单理解：
- 😎 **普通转账**: 所有人都能看到你转了多少钱
- 🔐 **FHEVM 转账**: 只有你自己能看到金额，其他人看到的是加密数据

### 3.2 为什么需要加密？

在盲拍系统中：
- ❌ **不加密**: 买家出价 100 ETH，所有人都能看到 → 别人出价 101 ETH
- ✅ **加密**: 买家出价加密，只有拍卖结束后才知道谁赢了

### 3.3 加密数据类型

| 类型 | 说明 | 用途 |
|------|------|------|
| `euint64` | 加密的 64 位整数 | 代币余额、出价金额 |
| `ebool` | 加密的布尔值 | 是否获胜 |
| `明文` | 普通数据 | 时间、地址、CID |

---

## 4. FHEVM 加解密详解

### 4.1 初始化 FHEVM

**第一步：创建 FHEVM 实例**

```javascript
// utils/fhevm.js
import { createInstance } from "fhevmjs";
import { BrowserProvider } from "ethers";

let fhevmInstance = null;

/**
 * 初始化 FHEVM 实例
 * 这个函数只需要调用一次，建议在应用启动时调用
 */
export async function initFhevm() {
  if (fhevmInstance) return fhevmInstance;

  try {
    // 1. 获取链 ID
    const provider = new BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("🔧 初始化 FHEVM，链 ID:", chainId);

    // 2. 创建 FHEVM 实例
    fhevmInstance = await createInstance({
      chainId,
      networkUrl: import.meta.env.VITE_SEPOLIA_RPC_URL,
      gatewayUrl: "https://gateway.sepolia.zama.ai", // Sepolia 网关
    });

    console.log("✅ FHEVM 初始化成功");
    return fhevmInstance;
  } catch (error) {
    console.error("❌ FHEVM 初始化失败:", error);
    throw error;
  }
}

/**
 * 获取 FHEVM 实例
 */
export function getFhevmInstance() {
  if (!fhevmInstance) {
    throw new Error("FHEVM 未初始化，请先调用 initFhevm()");
  }
  return fhevmInstance;
}
```

**第二步：在应用启动时初始化**

```javascript
// App.jsx 或 main.jsx
import { initFhevm } from "./utils/fhevm";

// 应用启动时调用
useEffect(() => {
  initFhevm().catch(console.error);
}, []);
```

---

### 4.2 加密数据（出价时使用）

**场景：用户出价 100,000 代币**

```javascript
/**
 * 加密出价金额
 * @param {string} contractAddress - 拍卖合约地址
 * @param {string} userAddress - 用户地址
 * @param {bigint} amount - 出价金额（如 100000n）
 * @returns {Promise<{handles: string[], inputProof: string}>}
 */
export async function encryptBidAmount(contractAddress, userAddress, amount) {
  try {
    const fhevm = getFhevmInstance();

    console.log("🔐 开始加密出价:", {
      amount: amount.toString(),
      contract: contractAddress,
      user: userAddress,
    });

    // 1. 创建加密输入（这是 FHEVM 的核心）
    const input = fhevm.createEncryptedInput(contractAddress, userAddress);

    // 2. 添加要加密的数值（64位整数）
    input.add64(amount);

    // 3. 执行加密
    const encryptedData = await input.encrypt();

    console.log("✅ 加密成功:", {
      handles: encryptedData.handles,
      proof: encryptedData.inputProof.substring(0, 20) + "...",
    });

    return {
      handles: encryptedData.handles,
      inputProof: encryptedData.inputProof,
    };
  } catch (error) {
    console.error("❌ 加密失败:", error);
    throw error;
  }
}
```

**使用示例：**

```javascript
// 出价组件中
async function handlePlaceBid() {
  const bidAmount = 100000n; // 出价 100,000 代币

  // 1. 加密出价金额
  const encrypted = await encryptBidAmount(
    CONTRACTS.BlindAuction,
    userAddress,
    bidAmount
  );

  // 2. 调用合约（后面会详细讲）
  await auctionContract.bid(
    auctionId,
    encrypted.handles[0],  // 加密句柄
    encrypted.inputProof   // 零知识证明
  );
}
```

---

### 4.3 解密数据（查看余额时使用）

**场景：查看自己的代币余额**

```javascript
/**
 * 解密代币余额
 * @param {string} tokenAddress - 代币合约地址
 * @param {string} userAddress - 用户地址
 * @param {Contract} tokenContract - ethers.js 合约实例
 * @param {Signer} signer - ethers.js 签名者
 * @returns {Promise<bigint>} 解密后的余额
 */
export async function decryptBalance(tokenAddress, userAddress, tokenContract, signer) {
  try {
    console.log("🔓 开始解密余额...");

    // 1. 获取加密余额（这是一个加密数据）
    const encryptedBalance = await tokenContract.confidentialBalanceOf(userAddress);

    console.log("📦 获取到加密余额:", encryptedBalance);

    // 2. 创建 EIP712 签名（用于授权解密）
    const fhevm = getFhevmInstance();

    // 获取用户公钥
    const { publicKey, privateKey } = fhevm.generateKeypair();
    const eip712 = fhevm.createEIP712(publicKey, tokenAddress);

    // 用户签名授权
    const signature = await signer.signTypedData(
      eip712.domain,
      { Reencrypt: eip712.types.Reencrypt },
      eip712.message
    );

    // 3. 解密
    const decryptedBalance = await fhevm.reencrypt(
      encryptedBalance,
      privateKey,
      publicKey,
      signature,
      tokenAddress,
      userAddress
    );

    console.log("✅ 解密成功，余额:", decryptedBalance.toString());

    return BigInt(decryptedBalance);
  } catch (error) {
    console.error("❌ 解密失败:", error);
    throw error;
  }
}
```

**简化版（推荐使用）：**

```javascript
/**
 * 简化版解密余额（使用 helper 函数）
 */
export async function getMyBalance(tokenContract, userAddress, signer) {
  try {
    const fhevm = getFhevmInstance();

    // 获取加密余额
    const encryptedBalance = await tokenContract.confidentialBalanceOf(userAddress);

    // 使用 fhevmjs 提供的 helper 函数解密
    const balance = await fhevm.decrypt(encryptedBalance, {
      contractAddress: tokenContract.target,
      userAddress,
      signer,
    });

    return BigInt(balance);
  } catch (error) {
    console.error("❌ 获取余额失败:", error);
    return 0n;
  }
}
```

**使用示例：**

```javascript
// 组件中显示余额
useEffect(() => {
  async function loadBalance() {
    const balance = await getMyBalance(tokenContract, userAddress, signer);
    setBalance(balance); // 100000n
    setBalanceFormatted((balance / 1000000n).toString()); // "0.1" (除以 10^6)
  }
  loadBalance();
}, [userAddress]);
```

---

## 5. 合约交互完整流程

### 5.1 连接钱包

```javascript
// utils/wallet.js
import { BrowserProvider } from "ethers";

/**
 * 连接 MetaMask 钱包
 */
export async function connectWallet() {
  if (!window.ethereum) {
    alert("请安装 MetaMask 钱包!");
    return null;
  }

  try {
    // 1. 请求连接
    await window.ethereum.request({ method: "eth_requestAccounts" });

    // 2. 创建 provider 和 signer
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();

    // 3. 检查网络
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== 11155111) {
      // 切换到 Sepolia
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }], // 11155111 的十六进制
      });
    }

    console.log("✅ 钱包连接成功:", address);

    return { provider, signer, address };
  } catch (error) {
    console.error("❌ 钱包连接失败:", error);
    return null;
  }
}
```

---

### 5.2 购买代币流程

**完整代码：**

```javascript
// components/BuyTokens.jsx
import { useState } from "react";
import { Contract, parseEther } from "ethers";
import { connectWallet } from "../utils/wallet";

const EXCHANGE_ADDRESS = "0x420d4172D8153cB3fB76b21Ffd0b482F62112f7C";

// TokenExchange ABI（只需要我们用到的函数）
const EXCHANGE_ABI = [
  "function buyTokens() payable",
  "function EXCHANGE_RATE() view returns (uint256)",
];

export function BuyTokens() {
  const [ethAmount, setEthAmount] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleBuy() {
    setLoading(true);
    try {
      // 1. 连接钱包
      const { signer } = await connectWallet();

      // 2. 创建合约实例
      const exchange = new Contract(EXCHANGE_ADDRESS, EXCHANGE_ABI, signer);

      // 3. 调用 buyTokens 函数
      console.log(`🛒 购买代币: ${ethAmount} ETH`);

      const tx = await exchange.buyTokens({
        value: parseEther(ethAmount), // "0.1" → 100000000000000000n
      });

      console.log("📤 交易已发送:", tx.hash);

      // 4. 等待确认
      const receipt = await tx.wait();

      console.log("✅ 交易确认:", receipt.hash);

      // 5. 计算获得的代币数量
      const tokensReceived = BigInt(ethAmount) * 1000000n;

      alert(`购买成功！获得 ${tokensReceived} 代币`);
    } catch (error) {
      console.error("❌ 购买失败:", error);
      alert("购买失败: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>购买代币</h2>
      <p>兑换比例: 1 ETH = 1,000,000 SAT</p>

      <input
        type="number"
        placeholder="ETH 数量"
        value={ethAmount}
        onChange={(e) => setEthAmount(e.target.value)}
        step="0.01"
        min="0"
      />

      <button onClick={handleBuy} disabled={loading || !ethAmount}>
        {loading ? "购买中..." : "购买代币"}
      </button>
    </div>
  );
}
```

---

### 5.3 创建拍卖流程

```javascript
// components/CreateAuction.jsx
import { useState } from "react";
import { Contract, parseEther } from "ethers";
import { connectWallet } from "../utils/wallet";

const AUCTION_ADDRESS = "0xb77038085AA13334C57278CD66dD10Ac7F4171b9";

const AUCTION_ABI = [
  "function createAuction(string metadataCID, uint256 auctionStartTime, uint256 auctionEndTime) payable",
  "function LISTING_FEE() view returns (uint256)",
];

export function CreateAuction() {
  const [metadata, setMetadata] = useState("");
  const [duration, setDuration] = useState(24); // 默认24小时
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setLoading(true);
    try {
      const { signer } = await connectWallet();
      const auction = new Contract(AUCTION_ADDRESS, AUCTION_ABI, signer);

      // 计算时间（Unix 时间戳，秒）
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + 300; // 5分钟后开始
      const endTime = startTime + duration * 3600; // duration 小时后结束

      console.log("📝 创建拍卖:", {
        metadata,
        startTime: new Date(startTime * 1000).toLocaleString(),
        endTime: new Date(endTime * 1000).toLocaleString(),
      });

      // 调用合约
      const tx = await auction.createAuction(metadata, startTime, endTime, {
        value: parseEther("0.01"), // 上架费 0.01 ETH
      });

      console.log("📤 交易已发送:", tx.hash);

      const receipt = await tx.wait();

      console.log("✅ 拍卖创建成功:", receipt.hash);

      alert("拍卖创建成功！");
    } catch (error) {
      console.error("❌ 创建失败:", error);
      alert("创建失败: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>创建拍卖</h2>

      <input
        type="text"
        placeholder="元数据 CID (如: QmXxx...)"
        value={metadata}
        onChange={(e) => setMetadata(e.target.value)}
      />

      <input
        type="number"
        placeholder="拍卖时长（小时）"
        value={duration}
        onChange={(e) => setDuration(Number(e.target.value))}
        min="1"
      />

      <p>上架费: 0.01 ETH</p>

      <button onClick={handleCreate} disabled={loading || !metadata}>
        {loading ? "创建中..." : "创建拍卖"}
      </button>
    </div>
  );
}
```

---

### 5.4 授权拍卖合约（重要！）

**在出价之前，必须先授权拍卖合约操作你的代币！**

```javascript
// components/ApproveAuction.jsx
import { useState } from "react";
import { Contract } from "ethers";
import { connectWallet } from "../utils/wallet";

const TOKEN_ADDRESS = "0x168ecd6465D5f6A479ef1cF7bc7B23748eD6e0c7";
const AUCTION_ADDRESS = "0xb77038085AA13334C57278CD66dD10Ac7F4171b9";

const TOKEN_ABI = [
  "function setOperator(address operator, uint256 expiry)",
];

export function ApproveAuction() {
  const [loading, setLoading] = useState(false);

  async function handleApprove() {
    setLoading(true);
    try {
      const { signer } = await connectWallet();
      const token = new Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);

      // 授权有效期：1年后
      const oneYear = Math.floor(Date.now() / 1000) + 365 * 86400;

      console.log("🔓 授权拍卖合约操作代币...");

      const tx = await token.setOperator(AUCTION_ADDRESS, oneYear);

      console.log("📤 交易已发送:", tx.hash);

      await tx.wait();

      console.log("✅ 授权成功");

      alert("授权成功！现在可以出价了");
    } catch (error) {
      console.error("❌ 授权失败:", error);
      alert("授权失败: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h3>⚠️ 出价前必须授权</h3>
      <p>授权拍卖合约操作你的代币（只需授权一次）</p>

      <button onClick={handleApprove} disabled={loading}>
        {loading ? "授权中..." : "授权拍卖合约"}
      </button>
    </div>
  );
}
```

---

### 5.5 加密出价流程（核心）

```javascript
// components/PlaceBid.jsx
import { useState } from "react";
import { Contract } from "ethers";
import { connectWallet } from "../utils/wallet";
import { getFhevmInstance } from "../utils/fhevm";

const AUCTION_ADDRESS = "0xb77038085AA13334C57278CD66dD10Ac7F4171b9";

const AUCTION_ABI = [
  "function bid(uint256 auctionId, bytes calldata encryptedAmount, bytes calldata inputProof)",
];

export function PlaceBid({ auctionId }) {
  const [bidAmount, setBidAmount] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleBid() {
    setLoading(true);
    try {
      // 1. 连接钱包
      const { signer, address } = await connectWallet();

      // 2. 创建合约实例
      const auction = new Contract(AUCTION_ADDRESS, AUCTION_ABI, signer);

      // 3. 加密出价金额
      console.log("🔐 加密出价金额:", bidAmount);

      const fhevm = getFhevmInstance();
      const amount = BigInt(bidAmount);

      const input = fhevm.createEncryptedInput(AUCTION_ADDRESS, address);
      input.add64(amount);
      const encrypted = await input.encrypt();

      console.log("✅ 加密完成");

      // 4. 调用合约出价
      console.log("📤 提交出价...");

      const tx = await auction.bid(
        auctionId,
        encrypted.handles[0],
        encrypted.inputProof
      );

      console.log("📤 交易已发送:", tx.hash);

      // 5. 等待确认
      await tx.wait();

      console.log("✅ 出价成功");

      alert(`出价成功！出价金额已加密，其他人无法看到`);
    } catch (error) {
      console.error("❌ 出价失败:", error);
      alert("出价失败: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>加密出价</h2>

      <input
        type="number"
        placeholder="出价金额（代币数量）"
        value={bidAmount}
        onChange={(e) => setBidAmount(e.target.value)}
        min="0"
      />

      <button onClick={handleBid} disabled={loading || !bidAmount}>
        {loading ? "出价中..." : "🔐 加密出价"}
      </button>

      <p style={{ color: "#666", fontSize: "14px" }}>
        💡 提示：你的出价金额会被加密，其他人无法看到具体金额
      </p>
    </div>
  );
}
```

---

### 5.6 拍卖结束后领取

```javascript
// components/ClaimAuction.jsx
import { useState } from "react";
import { Contract, parseEther } from "ethers";
import { connectWallet } from "../utils/wallet";

const AUCTION_ADDRESS = "0xb77038085AA13334C57278CD66dD10Ac7F4171b9";

const AUCTION_ABI = [
  "function claim(uint256 auctionId) payable",
  "function withdrawStake(uint256 auctionId)",
];

export function ClaimAuction({ auctionId }) {
  const [loading, setLoading] = useState(false);

  async function handleClaim() {
    setLoading(true);
    try {
      const { signer } = await connectWallet();
      const auction = new Contract(AUCTION_ADDRESS, AUCTION_ABI, signer);

      console.log("🎁 领取拍卖结果...");

      // 调用 claim，支付 0.05 ETH 押金
      const tx = await auction.claim(auctionId, {
        value: parseEther("0.05"),
      });

      console.log("📤 交易已发送:", tx.hash);

      await tx.wait();

      console.log("✅ 领取成功");

      alert(
        "领取成功！\n" +
        "- 如果你是获胜者：代币已转给卖家\n" +
        "- 如果你是败者：代币已退还给你\n\n" +
        "押金可以通过「提取押金」按钮取回"
      );
    } catch (error) {
      console.error("❌ 领取失败:", error);
      alert("领取失败: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleWithdrawStake() {
    setLoading(true);
    try {
      const { signer } = await connectWallet();
      const auction = new Contract(AUCTION_ADDRESS, AUCTION_ABI, signer);

      console.log("💰 提取押金...");

      const tx = await auction.withdrawStake(auctionId);

      console.log("📤 交易已发送:", tx.hash);

      await tx.wait();

      console.log("✅ 押金已退还");

      alert("押金（0.05 ETH）已退还到你的钱包");
    } catch (error) {
      console.error("❌ 提取失败:", error);
      alert("提取失败: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>领取拍卖结果</h2>

      <button onClick={handleClaim} disabled={loading}>
        {loading ? "领取中..." : "🎁 领取结果（需支付 0.05 ETH 押金）"}
      </button>

      <button onClick={handleWithdrawStake} disabled={loading}>
        {loading ? "提取中..." : "💰 提取押金"}
      </button>

      <div style={{ marginTop: "20px", padding: "10px", background: "#f0f0f0" }}>
        <h4>💡 说明：</h4>
        <ul>
          <li>所有出价者都需要调用「领取结果」</li>
          <li>需要支付 0.05 ETH 押金（防止垃圾出价）</li>
          <li>领取后可以立即提取押金（0.05 ETH）</li>
          <li>系统会自动判断你是获胜者还是败者</li>
        </ul>
      </div>
    </div>
  );
}
```

---

## 6. 代码示例

### 6.1 完整的 React Hook 示例

```javascript
// hooks/useAuction.js
import { useState, useEffect } from "react";
import { Contract, BrowserProvider } from "ethers";
import { getFhevmInstance } from "../utils/fhevm";

const AUCTION_ADDRESS = "0xb77038085AA13334C57278CD66dD10Ac7F4171b9";

const AUCTION_ABI = [
  "function getAuction(uint256 auctionId) view returns (address beneficiaryAddr, string metadataCID, uint256 startTime, uint256 endTime)",
  "function getUserBidAuctions(address user) view returns (uint256[])",
  "function nextAuctionId() view returns (uint256)",
];

export function useAuction() {
  const [auctions, setAuctions] = useState([]);
  const [myBids, setMyBids] = useState([]);
  const [loading, setLoading] = useState(false);

  // 获取所有拍卖
  async function loadAuctions() {
    setLoading(true);
    try {
      const provider = new BrowserProvider(window.ethereum);
      const auction = new Contract(AUCTION_ADDRESS, AUCTION_ABI, provider);

      // 获取拍卖总数
      const totalAuctions = await auction.nextAuctionId();

      console.log("📊 拍卖总数:", totalAuctions.toString());

      // 加载每个拍卖的详情
      const list = [];
      for (let i = 0; i < Number(totalAuctions); i++) {
        const details = await auction.getAuction(i);

        list.push({
          id: i,
          seller: details.beneficiaryAddr,
          metadata: details.metadataCID,
          startTime: Number(details.startTime),
          endTime: Number(details.endTime),
          status: getAuctionStatus(details.startTime, details.endTime),
        });
      }

      setAuctions(list);
    } catch (error) {
      console.error("❌ 加载拍卖失败:", error);
    } finally {
      setLoading(false);
    }
  }

  // 获取我参与的拍卖
  async function loadMyBids(userAddress) {
    try {
      const provider = new BrowserProvider(window.ethereum);
      const auction = new Contract(AUCTION_ADDRESS, AUCTION_ABI, provider);

      const bidIds = await auction.getUserBidAuctions(userAddress);

      console.log("🎯 我参与的拍卖:", bidIds);

      setMyBids(bidIds.map(Number));
    } catch (error) {
      console.error("❌ 加载失败:", error);
    }
  }

  // 判断拍卖状态
  function getAuctionStatus(startTime, endTime) {
    const now = Math.floor(Date.now() / 1000);

    if (now < Number(startTime)) {
      return "未开始";
    } else if (now < Number(endTime)) {
      return "进行中";
    } else {
      return "已结束";
    }
  }

  return {
    auctions,
    myBids,
    loading,
    loadAuctions,
    loadMyBids,
  };
}
```

---

### 6.2 完整页面示例

```javascript
// pages/AuctionPage.jsx
import { useState, useEffect } from "react";
import { initFhevm } from "../utils/fhevm";
import { connectWallet } from "../utils/wallet";
import { useAuction } from "../hooks/useAuction";
import { BuyTokens } from "../components/BuyTokens";
import { CreateAuction } from "../components/CreateAuction";
import { PlaceBid } from "../components/PlaceBid";
import { ClaimAuction } from "../components/ClaimAuction";

export function AuctionPage() {
  const [userAddress, setUserAddress] = useState("");
  const [fhevmReady, setFhevmReady] = useState(false);

  const { auctions, myBids, loading, loadAuctions, loadMyBids } = useAuction();

  // 初始化
  useEffect(() => {
    async function init() {
      // 1. 初始化 FHEVM
      await initFhevm();
      setFhevmReady(true);

      // 2. 连接钱包
      const wallet = await connectWallet();
      if (wallet) {
        setUserAddress(wallet.address);
      }

      // 3. 加载拍卖列表
      await loadAuctions();
    }

    init();
  }, []);

  // 加载我的出价
  useEffect(() => {
    if (userAddress) {
      loadMyBids(userAddress);
    }
  }, [userAddress]);

  if (!fhevmReady) {
    return <div>🔧 正在初始化 FHEVM...</div>;
  }

  return (
    <div>
      <h1>BlindAuction 盲拍系统</h1>

      <div>
        <strong>钱包地址:</strong> {userAddress || "未连接"}
      </div>

      <hr />

      <section>
        <h2>1. 购买代币</h2>
        <BuyTokens />
      </section>

      <hr />

      <section>
        <h2>2. 创建拍卖</h2>
        <CreateAuction />
      </section>

      <hr />

      <section>
        <h2>3. 拍卖列表</h2>

        {loading ? (
          <div>加载中...</div>
        ) : (
          <div>
            {auctions.map((auction) => (
              <div key={auction.id} style={{ border: "1px solid #ccc", padding: "10px", margin: "10px 0" }}>
                <h3>拍卖 #{auction.id}</h3>
                <p>卖家: {auction.seller}</p>
                <p>元数据: {auction.metadata}</p>
                <p>状态: {auction.status}</p>
                <p>
                  时间: {new Date(auction.startTime * 1000).toLocaleString()} ~{" "}
                  {new Date(auction.endTime * 1000).toLocaleString()}
                </p>

                {auction.status === "进行中" && (
                  <PlaceBid auctionId={auction.id} />
                )}

                {auction.status === "已结束" && myBids.includes(auction.id) && (
                  <ClaimAuction auctionId={auction.id} />
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
```

---

## 7. 常见问题

### Q1: FHEVM 初始化失败怎么办？

**错误信息**: `Error: Failed to fetch ACL contract`

**解决方法**:
1. 检查网络是否是 Sepolia (chainId: 11155111)
2. 检查 RPC URL 是否正确
3. 确保使用了正确的网关地址

```javascript
// 正确的配置
const fhevmInstance = await createInstance({
  chainId: 11155111,
  networkUrl: "https://sepolia.infura.io/v3/YOUR_KEY",
  gatewayUrl: "https://gateway.sepolia.zama.ai",
});
```

---

### Q2: 加密出价失败？

**错误信息**: `Error: Invalid encrypted input`

**常见原因**:
1. ❌ 使用了错误的合约地址
2. ❌ 用户地址不正确
3. ❌ 金额格式错误（必须是 BigInt）

**正确做法**:

```javascript
// ❌ 错误
input.add64(100000); // 错误：不是 BigInt

// ✅ 正确
input.add64(100000n); // 正确：使用 BigInt
```

---

### Q3: 解密余额失败？

**错误信息**: `Error: Decryption failed`

**常见原因**:
1. ❌ 尝试解密别人的余额（只能解密自己的）
2. ❌ 签名失败

**正确做法**:

```javascript
// 只能解密自己的余额
const myBalance = await tokenContract.confidentialBalanceOf(myAddress); // ✅
const otherBalance = await tokenContract.confidentialBalanceOf(otherAddress); // ❌ 无法解密
```

---

### Q4: 交易一直 pending？

**原因**: Gas 费设置过低

**解决方法**:

```javascript
// 手动设置 Gas 费
const tx = await contract.someFunction({
  gasLimit: 500000,
  maxFeePerGas: parseUnits("50", "gwei"),
  maxPriorityFeePerGas: parseUnits("2", "gwei"),
});
```

---

### Q5: 出价前忘记授权？

**错误信息**: `Error: ERC20: transfer amount exceeds allowance`

**解决方法**:
必须先调用 `token.setOperator(auctionAddress, expiry)`

```javascript
// 步骤1: 授权（只需一次）
await token.setOperator(AUCTION_ADDRESS, oneYear);

// 步骤2: 才能出价
await auction.bid(auctionId, encrypted.handles[0], encrypted.inputProof);
```

---

## 8. 调试技巧

### 8.1 查看交易详情

```javascript
async function debugTransaction(txHash) {
  const provider = new BrowserProvider(window.ethereum);
  const receipt = await provider.getTransactionReceipt(txHash);

  console.log("📋 交易详情:", {
    status: receipt.status, // 1 = 成功, 0 = 失败
    gasUsed: receipt.gasUsed.toString(),
    blockNumber: receipt.blockNumber,
    logs: receipt.logs,
  });
}
```

### 8.2 监听合约事件

```javascript
// 监听拍卖创建事件
auction.on("AuctionCreated", (auctionId, beneficiary, metadataCID, startTime, endTime) => {
  console.log("🎉 新拍卖创建:", {
    id: auctionId.toString(),
    seller: beneficiary,
    metadata: metadataCID,
  });
});

// 监听出价事件
auction.on("BidPlaced", (auctionId, bidder) => {
  console.log("💰 新出价:", {
    auctionId: auctionId.toString(),
    bidder,
  });
});
```

### 8.3 测试环境检查清单

```javascript
async function checkEnvironment() {
  console.log("🔍 环境检查:");

  // 1. 检查钱包
  console.log("钱包:", window.ethereum ? "✅ 已安装" : "❌ 未安装");

  // 2. 检查网络
  const provider = new BrowserProvider(window.ethereum);
  const network = await provider.getNetwork();
  console.log("网络:", network.chainId === 11155111n ? "✅ Sepolia" : `❌ ${network.name}`);

  // 3. 检查余额
  const signer = await provider.getSigner();
  const balance = await provider.getBalance(signer.address);
  console.log("ETH 余额:", parseFloat(formatEther(balance)).toFixed(4), "ETH");

  // 4. 检查 FHEVM
  try {
    const fhevm = getFhevmInstance();
    console.log("FHEVM:", fhevm ? "✅ 已初始化" : "❌ 未初始化");
  } catch {
    console.log("FHEVM:", "❌ 未初始化");
  }
}
```

---

## 9. 合约 ABI 完整版

```javascript
// utils/contracts.js

export const CONTRACTS = {
  MySecretToken: "0x168ecd6465D5f6A479ef1cF7bc7B23748eD6e0c7",
  TokenExchange: "0x420d4172D8153cB3fB76b21Ffd0b482F62112f7C",
  BlindAuction: "0xb77038085AA13334C57278CD66dD10Ac7F4171b9",
};

export const TOKEN_ABI = [
  "function confidentialBalanceOf(address account) view returns (bytes)",
  "function setOperator(address operator, uint256 expiry)",
  "function confidentialTransfer(address to, bytes calldata encryptedAmount)",
];

export const EXCHANGE_ABI = [
  "function buyTokens() payable",
  "function redeemTokens(bytes calldata encryptedAmount, bytes calldata inputProof)",
  "function EXCHANGE_RATE() view returns (uint256)",
  "function ethReserve() view returns (uint256)",
];

export const AUCTION_ABI = [
  "function createAuction(string metadataCID, uint256 auctionStartTime, uint256 auctionEndTime) payable",
  "function bid(uint256 auctionId, bytes calldata encryptedAmount, bytes calldata inputProof)",
  "function claim(uint256 auctionId) payable",
  "function withdrawStake(uint256 auctionId)",
  "function getAuction(uint256 auctionId) view returns (address beneficiaryAddr, string metadataCID, uint256 startTime, uint256 endTime)",
  "function getUserBidAuctions(address user) view returns (uint256[])",
  "function getUserCreatedAuctions(address user) view returns (uint256[])",
  "function nextAuctionId() view returns (uint256)",
  "function LISTING_FEE() view returns (uint256)",
  "function SUCCESS_FEE() view returns (uint256)",
  "event AuctionCreated(uint256 indexed auctionId, address indexed beneficiary, string metadataCID, uint256 auctionStartTime, uint256 auctionEndTime)",
  "event BidPlaced(uint256 indexed auctionId, address indexed bidder)",
  "event Claimed(uint256 indexed auctionId, address indexed claimer)",
];
```

---

## 10. 总结

### 核心流程总结：

```
1. 初始化 FHEVM              → initFhevm()
2. 连接钱包                  → connectWallet()
3. 购买代币                  → exchange.buyTokens()
4. 授权拍卖合约              → token.setOperator()
5. 创建拍卖（卖家）          → auction.createAuction()
6. 加密出价（买家）          → fhevm.createEncryptedInput() + auction.bid()
7. 拍卖结束后领取            → auction.claim()
8. 提取押金                  → auction.withdrawStake()
```

### 重要提示：

1. ⚠️ **必须先初始化 FHEVM** 才能加密/解密
2. ⚠️ **出价前必须授权** 拍卖合约
3. ⚠️ **加密出价金额** 使用 `BigInt`（如 `100000n`）
4. ⚠️ **只能解密自己的数据**（余额、出价等）
5. ⚠️ **Sepolia 测试网** 需要测试 ETH

---

## 📞 需要帮助？

- 📖 FHEVM 文档: https://docs.fhevm.io/
- 📖 Ethers.js 文档: https://docs.ethers.org/v6/
- 🔗 合约浏览器: https://sepolia.etherscan.io/
- 💬 遇到问题请联系后端开发

---

**祝对接顺利！🎉**
