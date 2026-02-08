# 盲拍合约前端对接文档

## 📋 目录

1. [概述](#概述)
2. [合约地址](#合约地址)
3. [环境配置](#环境配置)
4. [核心概念](#核心概念)
5. [API 接口详解](#api-接口详解)
6. [完整业务流程](#完整业务流程)
7. [事件监听](#事件监听)
8. [错误处理](#错误处理)
9. [最佳实践](#最佳实践)

---

## 概述

### 系统架构

本系统包含三个核心合约：

1. **MySecretToken (SAT)** - 加密代币合约
2. **TokenExchange** - 代币兑换合约 (ETH ↔ SAT)
3. **BlindAuction** - 盲拍主合约

### 核心特性

- ✅ **完全加密出价** - 使用 FHEVM 技术，出价金额完全加密
- ✅ **公平竞拍** - 任何人都无法看到其他人的出价
- ✅ **托管交易** - 获胜者代币进入托管，确认收货后才转给卖家
- ✅ **争议仲裁** - 支持买卖双方争议处理
- ✅ **押金可退** - 所有参与者的押金都可以退还

---

## 合约地址

### Sepolia 测试网

```typescript
export const CONTRACTS = {
  MySecretToken: "0x168ecd6465D5f6A479ef1cF7bc7B23748eD6e0c7",
  TokenExchange: "0x420d4172D8153cB3fB76b21Ffd0b482F62112f7C",
  BlindAuction: "0xb77038085AA13334C57278CD66dD10Ac7F4171b9",
};

export const NETWORK = {
  chainId: 11155111,
  name: "Sepolia",
  rpcUrl: "https://sepolia.infura.io/v3/YOUR_INFURA_KEY",
  fhevmGateway: "https://gateway.sepolia.zama.ai",
};
```

### 费用常量

```typescript
export const FEES = {
  LISTING_FEE: "0.01",      // ETH - 创建拍卖时支付
  SUCCESS_FEE: "0.05",      // ETH - 领取时支付(押金，可退还)
  DELIVERY_TIMEOUT: 30,     // 天 - 发货后自动确认收货时间
};

export const EXCHANGE_RATE = {
  ethToToken: 1000000,      // 1 ETH = 1,000,000 SAT
  tokenDecimals: 6,
};
```

---

## 环境配置

### 安装依赖

```bash
npm install ethers@6 fhevmjs
```

### 初始化 FHEVM

```typescript
import { ethers } from "ethers";
import { createInstance } from "fhevmjs";

// 初始化提供者和签名者
const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();

// 初始化 FHEVM 实例（用于加密）
const fhevmInstance = await createInstance({
  chainId: 11155111,
  networkUrl: "https://sepolia.infura.io/v3/YOUR_KEY",
  gatewayUrl: "https://gateway.sepolia.zama.ai/",
});
```

---

## 核心概念

### 拍卖状态

```typescript
enum DeliveryStatus {
  NotShipped = 0,    // 未发货
  Shipped = 1,       // 已发货
  Received = 2,      // 已收货
  Disputed = 3,      // 有争议
  Arbitrated = 4     // 已仲裁
}
```

### 拍卖数据结构

```typescript
interface Auction {
  beneficiary: string;          // 卖家地址
  metadataCID: string;          // IPFS CID
  listingFee: bigint;           // 上架费
  auctionStartTime: bigint;     // 开始时间
  auctionEndTime: bigint;       // 结束时间
  minimumBid: bigint;           // 最低出价
  currentWinner: string;        // 当前领先者
  winner: string;               // 最终获胜者
  deliveryStatus: number;       // 交付状态
  shipmentTime: bigint;         // 发货时间
  trackingInfo: string;         // 物流信息
}
```

### 元数据格式 (IPFS)

```typescript
interface AuctionMetadata {
  title: string;                // 拍品标题
  description: string;          // 详细描述
  category: string;             // 分类
  location: string;             // 地点
  imageUrl: string;             // 主图
  imageUrls: string[];          // 多图
  attributes?: {                // 自定义属性
    [key: string]: any;
  };
}
```

---

## API 接口详解

### 1. TokenExchange 合约

#### 1.1 购买代币

```typescript
/**
 * 用 ETH 购买 SAT 代币
 * @param ethAmount - ETH 数量 (字符串，如 "0.1")
 */
async function buyTokens(ethAmount: string) {
  const exchange = new ethers.Contract(
    CONTRACTS.TokenExchange,
    ["function buyTokens() external payable"],
    signer
  );

  const tx = await exchange.buyTokens({
    value: ethers.parseEther(ethAmount)
  });

  await tx.wait();
  return tx.hash;
}
```

**返回值**: 交易哈希

**Gas 估算**: ~50,000

**示例**:
```typescript
await buyTokens("0.1"); // 购买 100,000 SAT
```

#### 1.2 赎回 ETH

```typescript
/**
 * 将 SAT 代币兑换回 ETH
 * @param tokenAmount - SAT 数量 (uint64)
 */
async function redeemTokens(tokenAmount: bigint) {
  const exchange = new ethers.Contract(
    CONTRACTS.TokenExchange,
    ["function redeemTokens(uint64) external"],
    signer
  );

  const tx = await exchange.redeemTokens(tokenAmount);
  await tx.wait();
  return tx.hash;
}
```

**注意**: 赎回前需要先将代币转到 Exchange 合约

#### 1.3 计算兑换金额

```typescript
/**
 * 计算可购买的代币数量
 */
async function calculateTokenAmount(ethAmount: bigint): Promise<bigint> {
  const exchange = new ethers.Contract(
    CONTRACTS.TokenExchange,
    ["function calculateTokenAmount(uint256) external pure returns (uint256)"],
    provider
  );

  return await exchange.calculateTokenAmount(ethAmount);
}

/**
 * 计算赎回所需的 ETH
 */
async function calculateEthAmount(tokenAmount: bigint): Promise<bigint> {
  const exchange = new ethers.Contract(
    CONTRACTS.TokenExchange,
    ["function calculateEthAmount(uint64) external pure returns (uint256)"],
    provider
  );

  return await exchange.calculateEthAmount(tokenAmount);
}
```

---

### 2. MySecretToken 合约

#### 2.1 授权拍卖合约

```typescript
/**
 * 授权拍卖合约使用用户的代币
 * @param until - 授权有效期 (Unix 时间戳)
 */
async function approveAuction(until?: number) {
  const token = new ethers.Contract(
    CONTRACTS.MySecretToken,
    ["function setOperator(address operator, uint48 until) external"],
    signer
  );

  // 默认授权 1 年
  const expiry = until || Math.floor(Date.now() / 1000) + 365 * 86400;
  
  const tx = await token.setOperator(CONTRACTS.BlindAuction, expiry);
  await tx.wait();
  return tx.hash;
}
```

**重要**: 出价前必须先授权！

#### 2.2 查询余额

```typescript
/**
 * 查询加密代币余额
 * 注意: 返回的是加密值，需要解密才能看到实际余额
 */
async function getEncryptedBalance(address: string) {
  const token = new ethers.Contract(
    CONTRACTS.MySecretToken,
    ["function confidentialBalanceOf(address) external view returns (euint64)"],
    provider
  );

  return await token.confidentialBalanceOf(address);
}
```

---

### 3. BlindAuction 合约

#### 3.1 创建拍卖

```typescript
/**
 * 创建新拍卖
 * @param metadataCID - IPFS CID
 * @param startTime - 开始时间 (Unix 时间戳)
 * @param endTime - 结束时间 (Unix 时间戳)
 * @param minimumBid - 最低出价 (SAT，uint64)
 */
async function createAuction(
  metadataCID: string,
  startTime: number,
  endTime: number,
  minimumBid: bigint
): Promise<number> {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    [
      "function createAuction(string calldata, uint256, uint256, uint64) external payable returns (uint256)"
    ],
    signer
  );

  const tx = await auction.createAuction(
    metadataCID,
    startTime,
    endTime,
    minimumBid,
    { value: ethers.parseEther("0.01") } // 上架费
  );

  const receipt = await tx.wait();
  
  // 从事件中获取 auctionId
  const event = receipt.logs.find(
    log => log.topics[0] === ethers.id("AuctionCreated(uint256,address,string,uint256,uint256)")
  );
  
  const auctionId = ethers.toNumber(event.topics[1]);
  return auctionId;
}
```

**返回值**: 拍卖 ID

**Gas 估算**: ~200,000

**示例**:
```typescript
const now = Math.floor(Date.now() / 1000);
const auctionId = await createAuction(
  "QmXxx...",              // IPFS CID
  now + 3600,              // 1小时后开始
  now + 3600 + 86400 * 7,  // 持续7天
  ethers.parseUnits("1000", 6) // 最低出价 1000 SAT
);
```

#### 3.2 出价

```typescript
/**
 * 对拍卖出价
 * @param auctionId - 拍卖 ID
 * @param bidAmount - 出价金额 (SAT，字符串)
 */
async function placeBid(auctionId: number, bidAmount: string) {
  const signerAddress = await signer.getAddress();
  
  // 1. 转换金额
  const amount = ethers.parseUnits(bidAmount, 6);
  
  // 2. 🔐 加密出价金额
  const encryptedAmount = await fhevmInstance.encrypt64(amount);
  
  // 3. 生成输入证明
  const inputProof = fhevmInstance.generateInputProof(
    encryptedAmount,
    signerAddress
  );
  
  // 4. 提交出价
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    [
      "function bid(uint256, bytes calldata, bytes calldata) external"
    ],
    signer
  );
  
  const tx = await auction.bid(
    auctionId,
    encryptedAmount.data,
    inputProof
  );
  
  await tx.wait();
  return tx.hash;
}
```

**Gas 估算**: ~300,000 (FHE 运算成本较高)

**重要提示**:
- 出价前必须先授权 (`approveAuction`)
- 出价金额会被完全加密，链上无人可见
- 可以多次出价，金额会累加

#### 3.3 统一领取接口 (claim)

```typescript
/**
 * 拍卖结束后领取
 * - 获胜者: 代币进入托管
 * - 败者: 代币退还
 * @param auctionId - 拍卖 ID
 */
async function claim(auctionId: number) {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function claim(uint256) external payable"],
    signer
  );

  const tx = await auction.claim(auctionId, {
    value: ethers.parseEther("0.05") // 押金
  });

  await tx.wait();
  return tx.hash;
}
```

**返回值**: 交易哈希

**Gas 估算**: ~250,000

**说明**:
- 所有出价者都调用此接口
- 合约内部自动判断获胜/败者
- 获胜者: 代币进入托管，等待确认收货
- 败者: 代币直接退还

#### 3.4 提取押金

```typescript
/**
 * 提取押金 (所有人都可以)
 * @param auctionId - 拍卖 ID
 */
async function withdrawStake(auctionId: number) {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function withdrawStake(uint256) external"],
    signer
  );

  const tx = await auction.withdrawStake(auctionId);
  await tx.wait();
  return tx.hash;
}
```

**说明**: 必须先调用 `claim()` 才能提取押金

#### 3.5 卖家确认发货

```typescript
/**
 * 卖家确认发货
 * @param auctionId - 拍卖 ID
 * @param trackingInfo - 物流追踪信息
 */
async function confirmShipment(auctionId: number, trackingInfo: string) {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function confirmShipment(uint256, string calldata) external"],
    signer
  );

  const tx = await auction.confirmShipment(auctionId, trackingInfo);
  await tx.wait();
  return tx.hash;
}
```

**权限**: 仅拍卖创建者(卖家)可调用

#### 3.6 买家确认收货

```typescript
/**
 * 买家确认收货
 * @param auctionId - 拍卖 ID
 */
async function confirmReceipt(auctionId: number) {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function confirmReceipt(uint256) external"],
    signer
  );

  const tx = await auction.confirmReceipt(auctionId);
  await tx.wait();
  return tx.hash;
}
```

**权限**: 仅获胜者(买家)可调用

#### 3.7 卖家提取托管代币

```typescript
/**
 * 卖家提取托管的代币
 * @param auctionId - 拍卖 ID
 */
async function withdrawEscrow(auctionId: number) {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function withdrawEscrow(uint256) external"],
    signer
  );

  const tx = await auction.withdrawEscrow(auctionId);
  await tx.wait();
  return tx.hash;
}
```

**前置条件**: 买家已确认收货

#### 3.8 买家发起争议

```typescript
/**
 * 买家发起争议
 * @param auctionId - 拍卖 ID
 * @param reason - 争议原因
 */
async function raiseDispute(auctionId: number, reason: string) {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function raiseDispute(uint256, string calldata) external"],
    signer
  );

  const tx = await auction.raiseDispute(auctionId, reason);
  await tx.wait();
  return tx.hash;
}
```

**权限**: 仅获胜者可调用

**时机**: 已发货但未确认收货

#### 3.9 超时自动确认收货

```typescript
/**
 * 卖家在超时后自动确认收货并提取托管代币
 * @param auctionId - 拍卖 ID
 */
async function claimEscrowAfterTimeout(auctionId: number) {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function claimEscrowAfterTimeout(uint256) external"],
    signer
  );

  const tx = await auction.claimEscrowAfterTimeout(auctionId);
  await tx.wait();
  return tx.hash;
}
```

**前置条件**: 发货后 30 天买家未确认收货也未发起争议

#### 3.10 查询拍卖信息

```typescript
/**
 * 获取拍卖详情
 */
async function getAuction(auctionId: number): Promise<Auction> {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    [
      "function getAuction(uint256) external view returns (address, string, uint256, uint256, uint64)"
    ],
    provider
  );

  const [beneficiary, metadataCID, startTime, endTime, minimumBid] = 
    await auction.getAuction(auctionId);

  return {
    beneficiary,
    metadataCID,
    startTime,
    endTime,
    minimumBid
  };
}

/**
 * 获取拍卖完整信息 (包括状态)
 */
async function getAuctionFull(auctionId: number) {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function auctions(uint256) external view returns (tuple)"],
    provider
  );

  return await auction.auctions(auctionId);
}
```

#### 3.11 查询用户相关拍卖

```typescript
/**
 * 获取用户创建的拍卖列表
 */
async function getUserCreatedAuctions(userAddress: string): Promise<number[]> {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function getUserCreatedAuctions(address) external view returns (uint256[])"],
    provider
  );

  return await auction.getUserCreatedAuctions(userAddress);
}

/**
 * 获取用户出价的拍卖列表
 */
async function getUserBidAuctions(userAddress: string): Promise<number[]> {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function getUserBidAuctions(address) external view returns (uint256[])"],
    provider
  );

  return await auction.getUserBidAuctions(userAddress);
}
```

#### 3.12 查询出价信息

```typescript
/**
 * 获取用户的加密出价
 * 注意: 返回的是加密值
 */
async function getEncryptedBid(auctionId: number, bidder: string) {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function getEncryptedBid(uint256, address) external view returns (euint64)"],
    provider
  );

  return await auction.getEncryptedBid(auctionId, bidder);
}

/**
 * 获取出价时间戳
 */
async function getBidTimestamp(auctionId: number, bidder: string): Promise<bigint> {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function getBidTimestamp(uint256, address) external view returns (uint256)"],
    provider
  );

  return await auction.getBidTimestamp(auctionId, bidder);
}

/**
 * 获取拍卖的出价者列表
 */
async function getBidders(auctionId: number): Promise<string[]> {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function getBidders(uint256) external view returns (address[])"],
    provider
  );

  return await auction.getBidders(auctionId);
}
```

#### 3.13 查询领取和押金状态

```typescript
/**
 * 检查用户是否已领取
 */
async function hasClaimed(auctionId: number, user: string): Promise<boolean> {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function hasClaimed(uint256, address) external view returns (bool)"],
    provider
  );

  return await auction.hasClaimed(auctionId, user);
}

/**
 * 获取用户的押金金额
 */
async function getStake(auctionId: number, user: string): Promise<bigint> {
  const auction = new ethers.Contract(
    CONTRACTS.BlindAuction,
    ["function stakes(uint256, address) external view returns (uint256)"],
    provider
  );

  return await auction.stakes(auctionId, user);
}
```

---

## 完整业务流程

### 流程 1: 卖家创建拍卖

```typescript
async function createAuctionFlow() {
  // 1. 准备元数据
  const metadata: AuctionMetadata = {
    title: "限量版手办",
    description: "全新未拆封，带原装包装",
    category: "收藏品",
    location: "上海",
    imageUrl: "https://...",
    imageUrls: ["https://...", "https://..."],
  };

  // 2. 上传到 IPFS
  const cid = await uploadToIPFS(metadata);

  // 3. 设置拍卖时间
  const now = Math.floor(Date.now() / 1000);
  const startTime = now + 3600;           // 1小时后开始
  const endTime = startTime + 86400 * 7;  // 持续7天

  // 4. 创建拍卖
  const auctionId = await createAuction(
    cid,
    startTime,
    endTime,
    ethers.parseUnits("1000", 6) // 最低出价 1000 SAT
  );

  console.log(`✅ 拍卖创建成功！ID: ${auctionId}`);
  return auctionId;
}
```

### 流程 2: 买家出价

```typescript
async function bidFlow(auctionId: number) {
  // 1. 购买 SAT 代币
  await buyTokens("0.1"); // 购买 100,000 SAT
  console.log("✅ 代币购买成功");

  // 2. 授权拍卖合约
  await approveAuction();
  console.log("✅ 授权成功");

  // 3. 出价
  await placeBid(auctionId, "50000"); // 出价 50,000 SAT
  console.log("✅ 出价成功，金额已加密");
}
```

### 流程 3: 拍卖结束后领取

```typescript
async function claimFlow(auctionId: number) {
  // 1. 统一调用 claim 接口
  try {
    await claim(auctionId);
    console.log("✅ 领取成功");

    // 2. 检查是否是获胜者
    const auction = await getAuctionFull(auctionId);
    const myAddress = await signer.getAddress();

    if (auction.winner === myAddress) {
      console.log("🎉 恭喜！你是获胜者");
      console.log("等待卖家发货...");
    } else {
      console.log("出价已退还");
    }

    // 3. 提取押金
    await withdrawStake(auctionId);
    console.log("✅ 押金已退还");

  } catch (error) {
    console.error("领取失败:", error);
  }
}
```

### 流程 4: 卖家发货 → 买家确认收货

```typescript
async function deliveryFlow(auctionId: number) {
  // 卖家端
  async function sellerShip() {
    await confirmShipment(auctionId, "SF123456789");
    console.log("✅ 已确认发货");
  }

  // 买家端
  async function buyerConfirm() {
    await confirmReceipt(auctionId);
    console.log("✅ 已确认收货");
  }

  // 卖家提取代币
  async function sellerWithdraw() {
    await withdrawEscrow(auctionId);
    console.log("✅ 代币已提取");
  }

  // 执行流程
  await sellerShip();
  // ... 等待物流 ...
  await buyerConfirm();
  await sellerWithdraw();
}
```

### 流程 5: 争议处理

```typescript
async function disputeFlow(auctionId: number) {
  // 买家发起争议
  await raiseDispute(auctionId, "商品与描述不符");
  console.log("✅ 争议已提交");

  // 等待管理员仲裁...
  // (管理员会调用 adminArbitrate 函数)
}
```

---

## 事件监听

### 监听拍卖创建

```typescript
const auction = new ethers.Contract(
  CONTRACTS.BlindAuction,
  [
    "event AuctionCreated(uint256 indexed auctionId, address indexed beneficiary, string metadataCID, uint256 startTime, uint256 endTime)"
  ],
  provider
);

auction.on("AuctionCreated", (auctionId, beneficiary, metadataCID, startTime, endTime) => {
  console.log("新拍卖创建:", {
    auctionId: auctionId.toString(),
    beneficiary,
    metadataCID,
    startTime: new Date(Number(startTime) * 1000),
    endTime: new Date(Number(endTime) * 1000),
  });
});
```

### 监听出价

```typescript
auction.on("BidPlaced", (auctionId, bidder) => {
  console.log("新出价:", {
    auctionId: auctionId.toString(),
    bidder,
  });
});
```

### 监听领取

```typescript
auction.on("Claimed", (auctionId, claimer) => {
  console.log("用户领取:", {
    auctionId: auctionId.toString(),
    claimer,
  });
});
```

### 监听发货

```typescript
auction.on("ShipmentConfirmed", (auctionId, seller, trackingInfo) => {
  console.log("卖家已发货:", {
    auctionId: auctionId.toString(),
    seller,
    trackingInfo,
  });
});
```

### 监听收货

```typescript
auction.on("ReceiptConfirmed", (auctionId, buyer) => {
  console.log("买家已确认收货:", {
    auctionId: auctionId.toString(),
    buyer,
  });
});
```

### 监听争议

```typescript
auction.on("DisputeRaised", (auctionId, buyer, reason) => {
  console.log("买家发起争议:", {
    auctionId: auctionId.toString(),
    buyer,
    reason,
  });
});
```

### 完整事件列表

```typescript
// BlindAuction 事件
- AuctionCreated(uint256 indexed auctionId, address indexed beneficiary, string metadataCID, uint256 startTime, uint256 endTime)
- BidPlaced(uint256 indexed auctionId, address indexed bidder)
- Claimed(uint256 indexed auctionId, address indexed claimer)
- StakeWithdrawn(uint256 indexed auctionId, address indexed claimer, uint256 amount)
- ShipmentConfirmed(uint256 indexed auctionId, address indexed seller, string trackingInfo)
- ReceiptConfirmed(uint256 indexed auctionId, address indexed buyer)
- DisputeRaised(uint256 indexed auctionId, address indexed buyer, string reason)
- DisputeArbitrated(uint256 indexed auctionId, address indexed admin, bool refundToBuyer)
- EscrowWithdrawn(uint256 indexed auctionId, address indexed seller)
- EscrowClaimedAfterTimeout(uint256 indexed auctionId, address indexed seller)

// TokenExchange 事件
- TokensPurchased(address indexed buyer, uint256 ethAmount, uint64 tokenAmount)
- TokensRedeemed(address indexed seller, uint64 tokenAmount, uint256 ethAmount)
```

---

## 错误处理

### 常见错误

```typescript
// 1. 拍卖不存在
error AuctionNotFound()

// 2. 时间错误
error TooEarlyError(uint256 time)  // 调用过早
error TooLateError(uint256 time)   // 调用过晚

// 3. 权限错误
error OnlyOwner()                  // 仅所有者可调用

// 4. 合约暂停
error ContractPaused()

// 5. 出价者过多
error TooManyBidders()             // 超过 100 人

// 6. 无效地址
error InvalidAddress()
```

### 错误处理示例

```typescript
async function safePlaceBid(auctionId: number, amount: string) {
  try {
    await placeBid(auctionId, amount);
    return { success: true };
  } catch (error: any) {
    // 解析错误
    if (error.message.includes("TooEarlyError")) {
      return { success: false, error: "拍卖尚未开始" };
    } else if (error.message.includes("TooLateError")) {
      return { success: false, error: "拍卖已结束" };
    } else if (error.message.includes("TooManyBidders")) {
      return { success: false, error: "出价人数已满" };
    } else if (error.message.includes("insufficient funds")) {
      return { success: false, error: "余额不足" };
    } else {
      return { success: false, error: "出价失败: " + error.message };
    }
  }
}
```

### Revert 原因

```typescript
// 创建拍卖
"Invalid time"                    // 时间设置错误
"Start time cannot be in the past" // 开始时间在过去
"Metadata CID required"           // 缺少 CID
"Insufficient listing fee"        // 上架费不足
"Minimum bid must be greater than 0" // 最低出价为0

// 出价
"No bid to claim"                 // 没有出价记录

// 领取
"Already claimed"                 // 已经领取过
"Must stake 0.05 ETH"            // 押金不足

// 提取押金
"Must claim first"                // 必须先领取
"No stake to withdraw"            // 没有押金

// 发货
"Tracking info cannot be empty"   // 物流信息为空
"Only seller can confirm shipment" // 仅卖家可发货
"No winner yet"                   // 还没有获胜者
"Already shipped"                 // 已经发货

// 确认收货
"Only winner can confirm receipt" // 仅获胜者可确认
"Not shipped yet"                 // 还未发货

// 提取托管
"Only seller can withdraw"        // 仅卖家可提取
"Buyer has not confirmed receipt" // 买家未确认收货
"No escrowed tokens"              // 没有托管代币

// 争议
"Dispute reason cannot be empty"  // 争议原因为空
"Only winner can raise dispute"   // 仅获胜者可发起
"Can only dispute after shipment" // 只能在发货后发起

// 超时提取
"Only seller can claim"           // 仅卖家可提取
"Not in shipped status"           // 不在已发货状态
"Timeout not reached"             // 未到超时时间
```

---

## 最佳实践

### 1. Gas 优化

```typescript
// ❌ 不好的做法: 频繁查询
for (let i = 0; i < 100; i++) {
  await getAuction(i);
}

// ✅ 好的做法: 批量查询
const promises = [];
for (let i = 0; i < 100; i++) {
  promises.push(getAuction(i));
}
const auctions = await Promise.all(promises);
```

### 2. 错误处理

```typescript
// ✅ 始终使用 try-catch
async function safeOperation() {
  try {
    await someContractCall();
  } catch (error) {
    console.error("操作失败:", error);
    // 显示友好的错误提示
    showErrorToUser("操作失败，请稍后重试");
  }
}
```

### 3. 交易确认

```typescript
// ✅ 等待足够的确认数
const tx = await contract.someFunction();
const receipt = await tx.wait(2); // 等待 2 个确认
```

### 4. 前端状态管理

```typescript
// ✅ 使用状态管理跟踪交易
interface TxState {
  pending: boolean;
  hash?: string;
  error?: string;
}

const [txState, setTxState] = useState<TxState>({ pending: false });

async function handleBid() {
  setTxState({ pending: true });
  try {
    const hash = await placeBid(auctionId, amount);
    setTxState({ pending: false, hash });
  } catch (error) {
    setTxState({ pending: false, error: error.message });
  }
}
```

### 5. 用户体验

```typescript
// ✅ 提供清晰的进度提示
async function bidWithProgress(auctionId: number, amount: string) {
  showProgress("正在加密出价...");
  const encrypted = await encryptBid(amount);

  showProgress("正在提交交易...");
  const tx = await submitBid(auctionId, encrypted);

  showProgress("等待确认...");
  await tx.wait();

  showSuccess("出价成功！");
}
```

### 6. 安全检查

```typescript
// ✅ 出价前检查余额
async function safeBid(auctionId: number, amount: string) {
  // 1. 检查代币余额
  const balance = await getTokenBalance();
  if (balance < parseUnits(amount, 6)) {
    throw new Error("代币余额不足");
  }

  // 2. 检查授权
  const allowance = await checkAllowance();
  if (allowance === 0) {
    throw new Error("请先授权拍卖合约");
  }

  // 3. 检查拍卖状态
  const auction = await getAuction(auctionId);
  const now = Math.floor(Date.now() / 1000);
  if (now < auction.startTime) {
    throw new Error("拍卖尚未开始");
  }
  if (now >= auction.endTime) {
    throw new Error("拍卖已结束");
  }

  // 4. 执行出价
  await placeBid(auctionId, amount);
}
```

### 7. 缓存优化

```typescript
// ✅ 缓存不变的数据
const auctionCache = new Map<number, Auction>();

async function getAuctionCached(auctionId: number): Promise<Auction> {
  if (auctionCache.has(auctionId)) {
    return auctionCache.get(auctionId)!;
  }

  const auction = await getAuction(auctionId);
  auctionCache.set(auctionId, auction);
  return auction;
}
```

### 8. 时间处理

```typescript
// ✅ 统一使用 UTC 时间
function formatAuctionTime(timestamp: bigint): string {
  const date = new Date(Number(timestamp) * 1000);
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// ✅ 显示倒计时
function getTimeRemaining(endTime: bigint): string {
  const now = Math.floor(Date.now() / 1000);
  const remaining = Number(endTime) - now;

  if (remaining <= 0) return "已结束";

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);

  return `${days}天 ${hours}小时 ${minutes}分钟`;
}
```

---

## 附录

### A. 完整 ABI 文件位置

```
fhevm-hardhat-template/
  ├── BlindAuction.abi.json
  ├── artifacts/contracts/
  │   ├── BlindAuction.sol/BlindAuction.json
  │   ├── MySecretToken.sol/MySecretToken.json
  │   └── TokenExchange.sol/TokenExchange.json
```

### B. TypeScript 类型定义

```typescript
// types.ts
export interface Auction {
  beneficiary: string;
  metadataCID: string;
  listingFee: bigint;
  auctionStartTime: bigint;
  auctionEndTime: bigint;
  minimumBid: bigint;
  currentWinner: string;
  winner: string;
  deliveryStatus: DeliveryStatus;
  shipmentTime: bigint;
  trackingInfo: string;
}

export enum DeliveryStatus {
  NotShipped = 0,
  Shipped = 1,
  Received = 2,
  Disputed = 3,
  Arbitrated = 4,
}

export interface AuctionMetadata {
  title: string;
  description: string;
  category: string;
  location: string;
  imageUrl: string;
  imageUrls: string[];
  attributes?: Record<string, any>;
}
```

### C. 测试账户 (仅用于测试网)

```typescript
// 从 Hardhat 配置中获取
export const TEST_ACCOUNTS = {
  owner: "0xc7b0D4dc5184b95Dda276b475dF59C3686d3E724",
  // 其他测试账户...
};
```

### D. 有用的工具函数

```typescript
// utils.ts

/**
 * 格式化 SAT 代币数量
 */
export function formatSAT(amount: bigint): string {
  return ethers.formatUnits(amount, 6);
}

/**
 * 解析 SAT 代币数量
 */
export function parseSAT(amount: string): bigint {
  return ethers.parseUnits(amount, 6);
}

/**
 * 检查地址是否有效
 */
export function isValidAddress(address: string): boolean {
  return ethers.isAddress(address);
}

/**
 * 缩短地址显示
 */
export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * 获取交易链接
 */
export function getTxLink(txHash: string): string {
  return `https://sepolia.etherscan.io/tx/${txHash}`;
}

/**
 * 获取地址链接
 */
export function getAddressLink(address: string): string {
  return `https://sepolia.etherscan.io/address/${address}`;
}
```

---

## 联系方式

如有问题，请联系开发团队或查看以下资源：

- **GitHub**: [项目地址]
- **文档**: [在线文档]
- **Discord**: [社区链接]

---

**最后更新**: 2026-02-07
**版本**: v1.0.0
