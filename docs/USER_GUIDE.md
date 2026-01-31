# 盲拍系统用户指南

## 📚 系统概述

这是一个基于 FHEVM 的全同态加密盲拍系统，由三个核心合约组成：

### 合约架构

```
┌─────────────────────┐
│  MySecretToken     │  ← ERC7984 加密代币
│  (SAT)             │
└─────────────────────┘
          ↓
┌─────────────────────┐
│  TokenExchange     │  ← ETH ↔ SAT 兑换
└─────────────────────┘
          ↓
┌─────────────────────┐
│  BlindAuction      │  ← 盲拍主合约
└─────────────────────┘
```

---

## 💰 代币体系

### 什么是 SAT (Secret Auction Token)？

- **标准**: ERC7984（全同态加密代币）
- **特性**: 所有余额和转账金额完全加密
- **精度**: 6 位小数（与 USDC 相同）
- **用途**: 用于盲拍出价

### 兑换率

```
1 ETH = 1,000,000 SAT (10^6)
0.1 ETH = 100,000 SAT
0.01 ETH = 10,000 SAT
```

---

## 🎬 完整使用流程

### 阶段 1：部署合约（管理员）

```javascript
// 1. 部署加密代币
const token = await MySecretToken.deploy(
    "Secret Auction Token",
    "SAT",
    "ipfs://metadata"
);

// 2. 部署兑换合约
const exchange = await TokenExchange.deploy(token.address);

// 3. 将铸币权限转移给兑换合约
await token.transferOwnership(exchange.address);

// 4. 部署拍卖合约
const auction = await BlindAuction.deploy(token.address);

// 5. 为兑换合约添加初始储备金
await exchange.addReserve({value: ethers.parseEther("100")});
```

---

### 阶段 2：用户购买代币

#### 方式 1：直接购买

```javascript
// 用户 Alice 用 1 ETH 购买代币
await exchange.buyTokens({value: ethers.parseEther("1")});
// Alice 获得: 1,000,000 SAT
```

#### 方式 2：查看兑换率

```javascript
// 查询可购买的代币数量
const amount = await exchange.calculateTokenAmount(ethers.parseEther("0.5"));
console.log(`0.5 ETH = ${amount} SAT`);
// 输出: 0.5 ETH = 500000 SAT

// 购买
await exchange.buyTokens({value: ethers.parseEther("0.5")});
```

---

### 阶段 3：创建拍卖（卖家）

```javascript
// Alice 要拍卖一幅画
// 1. 准备元数据并上传到 IPFS
const metadata = {
    title: "星空下的咖啡馆",
    description: "梵高风格油画，尺寸 50x70cm",
    category: "艺术品",
    location: "上海",
    imageUrl: "ipfs://QmXxx.../main.jpg",
    imageUrls: [
        "ipfs://QmXxx.../img1.jpg",
        "ipfs://QmXxx.../img2.jpg"
    ],
    attributes: {
        artist: "未知",
        year: "2024",
        condition: "全新"
    }
};

const cid = await uploadToPinata(metadata);  // 假设这个函数上传到 Pinata

// 2. 创建拍卖（支付 0.01 ETH 上架费）
const startTime = Math.floor(Date.now() / 1000) + 86400;  // 明天开始
const endTime = startTime + 7 * 86400;  // 持续 7 天

const tx = await auction.createAuction(
    cid,          // IPFS CID
    startTime,
    endTime,
    {value: ethers.parseEther("0.01")}  // 上架费
);

const receipt = await tx.wait();
const auctionId = receipt.events[0].args.auctionId;
console.log(`拍卖创建成功！ID: ${auctionId}`);
```

---

### 阶段 4：出价（买家）

#### 准备：授权合约使用代币

```javascript
// Bob 先授权拍卖合约使用他的 SAT
// 注意：ERC7984 使用 operator 机制而非 approve
const oneYear = Math.floor(Date.now() / 1000) + 365 * 86400;
await token.setOperator(auction.address, oneYear);
```

#### 出价流程

```javascript
// Bob 想出价 50,000 SAT (0.05 ETH 等值)
const bidAmount = 50000n * 1000000n;  // 50,000 * 10^6

// 1. 生成加密出价（需要 FHEVM SDK）
const { encryptedAmount, inputProof } = await encryptAmount(
    bidAmount,
    bobAddress
);

// 2. 提交出价
await auction.bid(
    auctionId,
    encryptedAmount,
    inputProof
);

console.log("出价成功！金额已加密，其他人无法看到");
```

#### Charlie 出价更高

```javascript
// Charlie 出价 80,000 SAT
const bidAmount = 80000n * 1000000n;

const { encryptedAmount, inputProof } = await encryptAmount(
    bidAmount,
    charlieAddress
);

await auction.bid(auctionId, encryptedAmount, inputProof);
```

---

### 阶段 5：拍卖结束与揭示

#### 方式 1：竞争性揭示（推荐）

```javascript
// 拍卖结束后，任何出价者都可以尝试声明自己是获胜者
// Charlie 认为自己是获胜者，发起声明
await auction.claimWinner(auctionId);

// 如果 Charlie 真是获胜者，winnerAddress 会被设置为 Charlie
// 如果不是，后续 claimPrize 会失败
```

#### 方式 2：受益人辅助揭示

```javascript
// 如果没人主动声明，Alice（卖家）可以帮忙揭示
// Alice 需要知道谁的出价最高（可以询问出价者）
await auction.revealWinnerByBeneficiary(auctionId, charlieAddress);
```

---

### 阶段 6：获胜者领奖

```javascript
// Charlie 领取拍卖品
// 需要支付 0.05 ETH 成交手续费
const tx = await auction.winnerClaimPrize(
    auctionId,
    {value: ethers.parseEther("0.05")}
);

await tx.wait();

// ✅ 发生的事情：
// 1. Charlie 支付 0.05 ETH 给平台（成交费）
// 2. Charlie 的 80,000 SAT 转给 Alice
// 3. Charlie 获得拍卖品
// 4. 如果 Charlie 不是真获胜者，这笔转账会失败（转账 0）
```

---

### 阶段 7：败者提取退款

```javascript
// Bob 提取他的出价
await auction.withdraw(auctionId);

// ✅ Bob 的 50,000 SAT 被退还
```

---

### 阶段 8：赎回 ETH（可选）

```javascript
// Charlie 可以将获得的 SAT 兑换回 ETH
// 假设 Alice 转给了他 80,000 SAT

// 1. 授权兑换合约
await token.setOperator(exchange.address, oneYear);

// 2. 赎回
const tokenAmount = 80000n * 1000000n;
await exchange.redeemTokens(tokenAmount);

// ✅ Charlie 获得 0.08 ETH
```

---

## 📊 费用总览

### 卖家费用

| 项目 | 金额 | 时机 |
|-----|------|------|
| 上架费 | 0.01 ETH | 创建拍卖时 |
| **总计** | **0.01 ETH** | |

### 买家费用

| 项目 | 金额 | 时机 |
|-----|------|------|
| 成交费 | 0.05 ETH | 获胜者领奖时 |
| 出价金额 | 加密代币 | 出价时锁定，领奖时支付 |
| **总计（获胜者）** | **0.05 ETH + 出价金额** | |
| **总计（败者）** | **0 ETH**（全额退款） | |

### 平台收入

```
每笔成交 = 0.01 ETH (上架费) + 0.05 ETH (成交费) = 0.06 ETH
```

---

## 🔐 隐私保护

### 什么信息是加密的？

| 信息 | 状态 | 说明 |
|-----|------|------|
| 出价金额 | ✅ 加密 | 使用 FHEVM 完全同态加密 |
| 最高出价 | ✅ 加密 | 无人知道具体数值 |
| 个人余额 | ✅ 加密 | 只有用户和授权合约能看到 |
| 获胜者地址 | ❌ 揭示后公开 | 领奖后必须公开 |
| 拍卖元数据 | ❌ 公开 | 存储在 IPFS，任何人可查看 |

### 攻击防护

```
✅ Front-running 防护    - 出价加密，MEV 机器人无法狙击
✅ 假冒获胜者防护        - FHE.select 确保只有真获胜者能转账
✅ 重入攻击防护          - ReentrancyGuard 修饰符
⚠️ 受益人作恶风险        - 建议只在无人揭示时使用备用方案
```

---

## 💡 最佳实践

### 对于卖家

1. **准备高质量元数据**
   - 提供清晰的图片
   - 详细描述拍卖品
   - 设置合理的拍卖时长

2. **合理设置时间**
   - 给买家足够的时间准备
   - 避免节假日结束拍卖

3. **主动沟通**
   - 如果无人揭示获胜者，联系最可能的获胜者
   - 使用 `revealWinnerByBeneficiary` 辅助揭示

### 对于买家

1. **提前准备代币**
   - 在拍卖开始前购买足够的 SAT
   - 留出时间进行授权操作

2. **理性出价**
   - 出价金额会被锁定直到拍卖结束
   - 确保余额充足

3. **及时揭示和领奖**
   - 拍卖结束后立即调用 `claimWinner`
   - 48 小时内完成领奖

### 对于平台方

1. **维护充足储备金**
   - 确保兑换合约有足够 ETH 供用户赎回
   - 建议储备金 = 流通 SAT 的 50-100%

2. **定期提取手续费**
   - 调用 `auction.withdrawFees()` 提取累计手续费
   - 记录所有交易用于审计

3. **监控异常**
   - 关注是否有拍卖长时间无人揭示
   - 检查是否有恶意出价行为

---

## 🛠️ 开发者接口

### 查询拍卖信息

```javascript
// 获取拍卖详情
const auction = await contract.getAuction(auctionId);
console.log({
    beneficiary: auction.beneficiaryAddr,
    metadataCID: auction.metadataCID,
    startTime: new Date(auction.startTime * 1000),
    endTime: new Date(auction.endTime * 1000),
    winner: auction.winner,
    claimed: auction.claimed
});

// 获取用户创建的拍卖
const userAuctions = await contract.getUserCreatedAuctions(userAddress);

// 获取用户出价的拍卖
const userBids = await contract.getUserBidAuctions(userAddress);
```

### 查询代币信息

```javascript
// 获取加密余额（只有用户本人或授权合约能解密）
const encryptedBalance = await token.confidentialBalanceOf(userAddress);

// 检查是否是授权操作者
const isOperator = await token.isOperator(owner, spender);
```

---

## 📞 支持

如有问题，请联系：
- GitHub Issues: [链接]
- Discord: [链接]
- Email: support@example.com
