# 前端集成指南

## 安装依赖

```bash
npm install ethers fhevmjs
```

## 完整示例代码

```typescript
import { ethers } from "ethers";
import { createInstance } from "fhevmjs";

// 合约地址（部署后填入）
const TOKEN_EXCHANGE_ADDRESS = "0x...";
const BLIND_AUCTION_ADDRESS = "0x...";
const SECRET_TOKEN_ADDRESS = "0x...";

// 初始化
async function setup() {
  // 连接钱包
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  // 初始化 FHEVM 实例（用于加密）
  const fhevmInstance = await createInstance({
    chainId: 11155111, // Sepolia
    networkUrl: "https://sepolia.infura.io/v3/YOUR_KEY",
    gatewayUrl: "https://gateway.sepolia.zama.ai/",
  });

  return { provider, signer, fhevmInstance };
}

// ========== 步骤 1: 用户购买加密代币 ==========

async function buyTokens(ethAmount: string) {
  const { signer } = await setup();

  // 连接 TokenExchange 合约
  const exchange = new ethers.Contract(
    TOKEN_EXCHANGE_ADDRESS,
    [
      "function buyTokens() external payable",
      "function calculateTokenAmount(uint256) external pure returns (uint256)"
    ],
    signer
  );

  // 查看可以购买多少代币
  const tokenAmount = await exchange.calculateTokenAmount(
    ethers.parseEther(ethAmount)
  );
  console.log(`${ethAmount} ETH = ${ethers.formatUnits(tokenAmount, 6)} SAT`);

  // 购买代币
  const tx = await exchange.buyTokens({
    value: ethers.parseEther(ethAmount)
  });

  await tx.wait();
  console.log("✅ 代币购买成功！");
}

// ========== 步骤 2: 授权拍卖合约 ==========

async function approveAuction() {
  const { signer } = await setup();

  // 连接代币合约
  const token = new ethers.Contract(
    SECRET_TOKEN_ADDRESS,
    [
      "function setOperator(address operator, uint48 until) external"
    ],
    signer
  );

  // 授权拍卖合约使用代币（有效期 1 年）     
  const oneYear = Math.floor(Date.now() / 1000) + 365 * 86400;
  const tx = await token.setOperator(BLIND_AUCTION_ADDRESS, oneYear);

  await tx.wait();
  console.log("✅ 授权成功！");
}

// ========== 步骤 3: 创建拍卖 ==========

async function createAuction(metadata: AuctionMetadata) {
  const { signer } = await setup();

  // 1. 上传元数据到 Pinata
  const cid = await uploadToPinata(metadata);

  // 2. 连接拍卖合约
  const auction = new ethers.Contract(
    BLIND_AUCTION_ADDRESS,
    [
      "function createAuction(string calldata, uint256, uint256) external payable returns (uint256)"
    ],
    signer
  );

  // 3. 设置拍卖时间
  const now = Math.floor(Date.now() / 1000);
  const startTime = now + 86400;      // 明天开始
  const endTime = startTime + 604800; // 持续 7 天

  // 4. 创建拍卖（支付 0.01 ETH 上架费）
  const tx = await auction.createAuction(
    cid,
    startTime,
    endTime,
    { value: ethers.parseEther("0.01") }
  );

  const receipt = await tx.wait();
  const auctionId = receipt.logs[0].args[0];

  console.log(`✅ 拍卖创建成功！ID: ${auctionId}`);
  return auctionId;
}

// ========== 步骤 4: 加密出价 ==========

async function placeBid(auctionId: number, bidAmountSAT: string) {
  const { signer, fhevmInstance } = await setup();
  const signerAddress = await signer.getAddress();

  // 1. 转换金额（SAT 有 6 位小数）
  const bidAmount = ethers.parseUnits(bidAmountSAT, 6);
  console.log(`出价金额: ${bidAmountSAT} SAT (${bidAmount} 最小单位)`);

  // 2. 🔐 使用 FHEVM 加密出价金额
  const encryptedAmount = await fhevmInstance.encrypt64(bidAmount);

  console.log("🔐 出价已加密，无人能看到金额");

  // 3. 生成输入证明
  const inputProof = fhevmInstance.generateInputProof(
    encryptedAmount,
    signerAddress
  );

  // 4. 提交出价到合约
  const auction = new ethers.Contract(
    BLIND_AUCTION_ADDRESS,
    [
      "function bid(uint256, bytes calldata, bytes calldata) external"
    ],
    signer
  );

  const tx = await auction.bid(
    auctionId,
    encryptedAmount.data,  // 加密数据
    inputProof             // 证明
  );

  await tx.wait();
  console.log("✅ 出价成功！");
}

// ========== 步骤 5: 揭示获胜者 ==========

async function revealWinner(auctionId: number) {
  const { signer } = await setup();

  const auction = new ethers.Contract(
    BLIND_AUCTION_ADDRESS,
    [
      "function claimWinner(uint256) external"
    ],
    signer
  );

  try {
    const tx = await auction.claimWinner(auctionId);
    await tx.wait();
    console.log("✅ 成功声明为获胜者！");
  } catch (error) {
    console.log("❌ 声明失败，你可能不是获胜者");
  }
}

// ========== 步骤 6: 获胜者领奖 ==========

async function claimPrize(auctionId: number) {
  const { signer } = await setup();

  const auction = new ethers.Contract(
    BLIND_AUCTION_ADDRESS,
    [
      "function winnerClaimPrize(uint256) external payable"
    ],
    signer
  );

  // 支付 0.05 ETH 成交手续费
  const tx = await auction.winnerClaimPrize(
    auctionId,
    { value: ethers.parseEther("0.05") }
  );

  await tx.wait();
  console.log("✅ 领奖成功！");
}

// ========== 步骤 7: 败者提取退款 ==========

async function withdrawBid(auctionId: number) {
  const { signer } = await setup();

  const auction = new ethers.Contract(
    BLIND_AUCTION_ADDRESS,
    [
      "function withdraw(uint256) external"
    ],
    signer
  );

  const tx = await auction.withdraw(auctionId);
  await tx.wait();
  console.log("✅ 出价已退还！");
}

// ========== 步骤 8: 赎回 ETH ==========

async function redeemTokens(tokenAmountSAT: string) {
  const { signer } = await setup();

  const exchange = new ethers.Contract(
    TOKEN_EXCHANGE_ADDRESS,
    [
      "function redeemTokens(uint64) external",
      "function calculateEthAmount(uint64) external pure returns (uint256)"
    ],
    signer
  );

  const tokenAmount = ethers.parseUnits(tokenAmountSAT, 6);

  // 查看可以赎回多少 ETH
  const ethAmount = await exchange.calculateEthAmount(tokenAmount);
  console.log(`${tokenAmountSAT} SAT = ${ethers.formatEther(ethAmount)} ETH`);

  // 赎回
  const tx = await exchange.redeemTokens(tokenAmount);
  await tx.wait();
  console.log("✅ ETH 赎回成功！");
}

// ========== 辅助函数 ==========

interface AuctionMetadata {
  title: string;
  description: string;
  category: string;
  location: string;
  imageUrl: string;
  imageUrls: string[];
  attributes?: Record<string, any>;
}

async function uploadToPinata(metadata: AuctionMetadata): Promise<string> {
  const PINATA_JWT = "YOUR_PINATA_JWT";

  const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${PINATA_JWT}`
    },
    body: JSON.stringify(metadata)
  });

  const result = await response.json();
  return result.IpfsHash;
}

// ========== React 组件示例 ==========

function BidComponent({ auctionId }: { auctionId: number }) {
  const [bidAmount, setBidAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const handleBid = async () => {
    setLoading(true);
    try {
      await placeBid(auctionId, bidAmount);
      alert("出价成功！");
    } catch (error) {
      console.error(error);
      alert("出价失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input
        type="number"
        value={bidAmount}
        onChange={(e) => setBidAmount(e.target.value)}
        placeholder="出价金额 (SAT)"
      />
      <button onClick={handleBid} disabled={loading}>
        {loading ? "提交中..." : "出价"}
      </button>
      <p>💡 提示：你的出价会被加密，其他人无法看到</p>
    </div>
  );
}

export {
  buyTokens,
  approveAuction,
  createAuction,
  placeBid,
  revealWinner,
  claimPrize,
  withdrawBid,
  redeemTokens
};
```

## 关键流程图

```
用户操作流程：

1️⃣ 购买代币
   用户钱包 (0.1 ETH)
        ↓ buyTokens()
   TokenExchange
        ↓
   用户获得 100,000 SAT (加密)

2️⃣ 授权合约
   setOperator(auctionAddress, expiry)
        ↓
   拍卖合约可以使用用户的代币

3️⃣ 出价
   前端: 用户输入 "50000 SAT"
        ↓ encrypt64(50000 * 10^6)
   前端: 生成加密数据
        ↓ bid(auctionId, encrypted, proof)
   合约: 收到加密出价 ✅
        ↓
   链上: 完全加密，无人可见 🔒

4️⃣ 拍卖结束
   任何出价者可以尝试声明获胜
        ↓ claimWinner()
   第一个成功声明者被记录

5️⃣ 领奖验证
   声明者调用 claimPrize()
        ↓ FHE.eq(myBid, highestBid)
   合约内部加密验证
        ↓ FHE.select(isWinner, amount, 0)
   只有真获胜者转账成功 ✅

6️⃣ 退款
   败者调用 withdraw()
        ↓
   全额退还加密代币 ✅
```

## 安全提示

### 前端需要做的

1. **保管私钥**
   - 使用 MetaMask 等钱包
   - 不要在代码中硬编码私钥

2. **验证合约地址**
   - 确保连接到正确的合约地址
   - 防止钓鱼攻击

3. **检查授权**
   - 授权前显示清楚的提示
   - 定期检查并撤销不必要的授权

4. **处理错误**
   - 捕获所有可能的异常
   - 给用户清晰的错误提示

### 用户需要知道的

1. **出价加密**
   - 出价金额完全加密
   - 其他人无法看到你的出价
   - 包括合约 owner 也看不到

2. **不可撤回**
   - 出价提交后无法修改
   - 只能增加出价，不能减少
   - 拍卖结束前资金被锁定

3. **Gas 费用**
   - 出价需要支付 gas 费
   - FHE 运算 gas 成本较高
   - 建议准备足够的 ETH

4. **领奖时效**
   - 拍卖结束后及时声明和领奖
   - 避免被其他人抢先

## 常见问题

### Q: 为什么需要先购买 SAT 代币？
A: SAT 是加密代币，可以保持出价隐私。普通 ETH 无法加密。

### Q: 购买代币后可以退款吗？
A: 可以！随时可以通过 `redeemTokens()` 将 SAT 兑换回 ETH。

### Q: 出价会被别人看到吗？
A: 不会！出价金额在前端就被加密了，链上完全加密存储。

### Q: 如果我不是获胜者会怎样？
A: 可以调用 `withdraw()` 全额退还你的出价。

### Q: 加密会影响性能吗？
A: 前端加密很快（<1秒），链上 FHE 运算会消耗更多 gas。

### Q: 如何验证我是获胜者？
A: 拍卖结束后调用 `claimWinner()`，如果成功就是获胜者。

### Q: 为什么领奖要额外支付 0.05 ETH？
A: 这是平台的成交手续费，用于维护系统运营。
