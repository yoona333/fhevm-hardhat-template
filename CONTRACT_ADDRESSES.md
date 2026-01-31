# 🔗 BlindAuction 合约地址

## Sepolia 测试网

部署时间：2026-01-29 15:56

### 合约地址

```javascript
const CONTRACTS = {
  MySecretToken: "0x168ecd6465D5f6A479ef1cF7bc7B23748eD6e0c7",
  TokenExchange: "0x420d4172D8153cB3fB76b21Ffd0b482F62112f7C",
  BlindAuction: "0xb77038085AA13334C57278CD66dD10Ac7F4171b9",
};
```

### Etherscan 链接

- **MySecretToken**: https://sepolia.etherscan.io/address/0x168ecd6465D5f6A479ef1cF7bc7B23748eD6e0c7#code
- **TokenExchange**: https://sepolia.etherscan.io/address/0x420d4172D8153cB3fB76b21Ffd0b482F62112f7C#code
- **BlindAuction**: https://sepolia.etherscan.io/address/0xb77038085AA13334C57278CD66dD10Ac7F4171b9#code

---

## 合约功能

### MySecretToken (ERC7984)
- **地址**: `0x168ecd6465D5f6A479ef1cF7bc7B23748eD6e0c7`
- **名称**: Secret Auction Token (SAT)
- **小数位数**: 6
- **功能**: 加密余额、加密转账、加密授权

### TokenExchange
- **地址**: `0x420d4172D8153cB3fB76b21Ffd0b482F62112f7C`
- **兑换比例**: 1 ETH = 1,000,000 SAT
- **功能**: 购买代币、赎回代币、储备金管理

### BlindAuction
- **地址**: `0xb77038085AA13334C57278CD66dD10Ac7F4171b9`
- **上架费**: 0.01 ETH
- **押金**: 0.05 ETH (可退还)
- **功能**: 创建拍卖、加密出价、领取结果、平局保护

---

## 部署账户

- **Owner**: `0xc7b0D4dc5184b95Dda276b475dF59C3686d3E724`

---

## 使用方法

### 前端集成

```javascript
// 引入 ethers.js
import { Contract, BrowserProvider } from "ethers";

// 合约地址
const AUCTION_ADDRESS = "0xb77038085AA13334C57278CD66dD10Ac7F4171b9";

// 连接合约
const provider = new BrowserProvider(window.ethereum);
const auction = new Contract(AUCTION_ADDRESS, ABI, provider);
```

### 直接在 Etherscan 上交互

1. 访问合约页面
2. 点击 "Contract" → "Write Contract"
3. 连接 MetaMask
4. 调用合约函数

---

## 测试数据

### 网络信息
- **Chain ID**: 11155111
- **网络名称**: Sepolia
- **RPC URL**: https://sepolia.infura.io/v3/YOUR_INFURA_KEY
- **浏览器**: https://sepolia.etherscan.io/

### 获取测试 ETH
- https://sepoliafaucet.com/
- https://www.alchemy.com/faucets/ethereum-sepolia

---

## 状态

- ✅ 已部署
- ✅ 已验证源代码
- ✅ 所有权已配置（Token 所有权转移给 Exchange）
- ✅ 测试通过（69/69）

---

## 更新日志

### 2026-01-29
- ✅ 部署到 Sepolia 测试网
- ✅ 修复平局漏洞
- ✅ 简化押金机制（所有人可提取）
- ✅ 验证所有合约

---

**部署完成！🎉**
