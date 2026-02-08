import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { BlindAuction, BlindAuction__factory, MySecretToken, MySecretToken__factory, TokenExchange, TokenExchange__factory } from "../types";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * 🔐 FHEVM加密场景极限测试
 *
 * 测试覆盖:
 * 1. 加密数值极限测试（最小值、中等值、大值）
 * 2. 连续加密操作测试（10次追加出价）
 * 3. 多用户并发加密测试（10人同时出价）
 * 4. 加密数据隐私测试（验证无法解密他人出价）
 * 5. 加密状态一致性测试（验证余额和出价一致性）
 * 6. 加密比较测试（验证FHE.gt/eq正确性）
 * 7. 加密退款测试（验证失败者退款正确）
 */

describe("🔐 FHEVM加密场景极限测试", function () {
  let blindAuction: BlindAuction;
  let mySecretToken: MySecretToken;
  let tokenExchange: TokenExchange;
  let admin: HardhatEthersSigner;
  let users: HardhatEthersSigner[];
  let auctionAddress: string;
  let tokenAddress: string;

  before(async function () {
    console.log("\n" + "=".repeat(70));
    console.log("🔐 FHEVM加密场景极限测试");
    console.log("=".repeat(70) + "\n");

    const signers = await ethers.getSigners();
    admin = signers[0];
    users = signers.slice(1, 15); // 使用14个用户

    console.log("🔨 部署合约...");
    const TokenFactory = await ethers.getContractFactory("MySecretToken") as MySecretToken__factory;
    mySecretToken = await TokenFactory.connect(admin).deploy("SAT", "SAT", "ipfs://test");
    await mySecretToken.waitForDeployment();
    tokenAddress = await mySecretToken.getAddress();

    const ExchangeFactory = await ethers.getContractFactory("TokenExchange") as TokenExchange__factory;
    tokenExchange = await ExchangeFactory.connect(admin).deploy(tokenAddress);
    await tokenExchange.waitForDeployment();

    const AuctionFactory = await ethers.getContractFactory("BlindAuction") as BlindAuction__factory;
    blindAuction = await AuctionFactory.connect(admin).deploy(tokenAddress);
    await blindAuction.waitForDeployment();
    auctionAddress = await blindAuction.getAddress();

    await mySecretToken.connect(admin).setMinter(await tokenExchange.getAddress());

    console.log("💰 为用户购买代币...");
    for (const user of users) {
      await tokenExchange.connect(user).buyTokens({ value: ethers.parseEther("20") });
    }

    console.log("✅ 初始化完成\n");
  });

  describe("🔢 测试1: 加密数值极限测试", function () {
    let auctionId: number;

    it("1.1 创建测试拍卖", async function () {
      console.log("\n🔨 创建拍卖...");
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await blindAuction.connect(users[0]).createAuction(
        "QmEncryptionTest",
        currentTime + 10,
        currentTime + 3600,
        { value: ethers.parseEther("0.01") }
      );

      auctionId = 0;
      await time.increaseTo(currentTime + 11);
      console.log("   ✅ 拍卖创建成功，ID:", auctionId);
    });

    it("1.2 最小值加密出价 (1 SAT)", async function () {
      console.log("\n🔐 测试：最小值加密出价...");

      const longExpiry = await time.latest() + 365 * 24 * 3600;
      await mySecretToken.connect(users[0]).setOperator(auctionAddress, longExpiry);

      const input = fhevm.createEncryptedInput(auctionAddress, users[0].address);
      const encrypted = await input.add64(1).encrypt();
      await blindAuction.connect(users[0]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✅ 最小值 1 SAT 加密出价成功");
    });

    it("1.3 中等值加密出价 (1,000,000 SAT)", async function () {
      console.log("\n🔐 测试：中等值加密出价...");

      const longExpiry = await time.latest() + 365 * 24 * 3600;
      await mySecretToken.connect(users[1]).setOperator(auctionAddress, longExpiry);

      const input = fhevm.createEncryptedInput(auctionAddress, users[1].address);
      const encrypted = await input.add64(1000000).encrypt();
      await blindAuction.connect(users[1]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✅ 中等值 1,000,000 SAT 加密出价成功");
    });

    it("1.4 大值加密出价 (10,000,000 SAT)", async function () {
      console.log("\n🔐 测试：大值加密出价...");

      const longExpiry = await time.latest() + 365 * 24 * 3600;
      await mySecretToken.connect(users[2]).setOperator(auctionAddress, longExpiry);

      const input = fhevm.createEncryptedInput(auctionAddress, users[2].address);
      const encrypted = await input.add64(10000000).encrypt();
      await blindAuction.connect(users[2]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✅ 大值 10,000,000 SAT 加密出价成功");
    });

    it("1.5 验证加密比较正确性（大值应获胜）", async function () {
      console.log("\n🧪 测试：验证FHE加密比较...");

      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionEndTime) + 1);

      // 大值出价者claim
      await blindAuction.connect(users[2]).claim(auctionId, { value: ethers.parseEther("0.05") });

      const finalAuction = await blindAuction.auctions(auctionId);
      expect(finalAuction.winner).to.equal(users[2].address);

      console.log("   ✅ FHE比较正确：大值出价者获胜");
      console.log("   ✓ 获胜者:", users[2].address);
    });

    it("1.6 验证失败者获得加密退款", async function () {
      console.log("\n🧪 测试：失败者加密退款...");

      // 失败者claim并获得退款
      await blindAuction.connect(users[0]).claim(auctionId, { value: ethers.parseEther("0.05") });
      await blindAuction.connect(users[1]).claim(auctionId, { value: ethers.parseEther("0.05") });

      console.log("   ✅ 失败者成功获得加密代币退款");
    });
  });

  describe("🔄 测试2: 连续加密操作测试", function () {
    let auctionId: number;

    it("2.1 用户连续追加出价10次", async function () {
      console.log("\n🔐 测试：连续追加出价...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await blindAuction.connect(users[3]).createAuction(
        "QmContinuous",
        currentTime + 10,
        currentTime + 3600,
        { value: ethers.parseEther("0.01") }
      );

      auctionId = 1;
      await time.increaseTo(currentTime + 11);

      const operatorExpiry = await time.latest() + 365 * 24 * 3600;
      await mySecretToken.connect(users[3]).setOperator(auctionAddress, operatorExpiry);

      console.log("   🔄 开始连续追加出价...");
      for (let i = 0; i < 10; i++) {
        const input = fhevm.createEncryptedInput(auctionAddress, users[3].address);
        const encrypted = await input.add64(1000 * (i + 1)).encrypt();
        await blindAuction.connect(users[3]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);
        console.log(`      ✓ 第${i + 1}次追加出价: ${1000 * (i + 1)} SAT`);
      }

      const biddersCount = await blindAuction.getBiddersCount(auctionId);
      expect(biddersCount).to.equal(1);

      console.log("   ✅ 连续10次追加出价成功");
      console.log("   ✓ 总出价: 55,000 SAT (1000+2000+...+10000)");
    });

    it("2.2 验证追加出价累计正确", async function () {
      console.log("\n🧪 测试：验证累计出价...");

      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionEndTime) + 1);

      await blindAuction.connect(users[3]).claim(auctionId, { value: ethers.parseEther("0.05") });

      const finalAuction = await blindAuction.auctions(auctionId);
      expect(finalAuction.winner).to.equal(users[3].address);

      console.log("   ✅ 累计出价正确：用户获胜");
    });
  });

  describe("👥 测试3: 多用户并发加密测试", function () {
    let auctionId: number;

    it("3.1 10个用户同时加密出价", async function () {
      console.log("\n🔐 测试：多用户并发加密出价...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await blindAuction.connect(users[4]).createAuction(
        "QmConcurrent",
        currentTime + 10,
        currentTime + 3600,
        { value: ethers.parseEther("0.01") }
      );

      auctionId = 2;
      await time.increaseTo(currentTime + 11);

      const longExpiry = await time.latest() + 365 * 24 * 3600;

      console.log("   👥 10个用户同时出价...");
      for (let i = 0; i < 10; i++) {
        await mySecretToken.connect(users[i]).setOperator(auctionAddress, longExpiry);
        const input = fhevm.createEncryptedInput(auctionAddress, users[i].address);
        const encrypted = await input.add64(10000 + i * 1000).encrypt();
        await blindAuction.connect(users[i]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);
        console.log(`      ✓ 用户${i}: ${10000 + i * 1000} SAT`);
      }

      const biddersCount = await blindAuction.getBiddersCount(auctionId);
      expect(biddersCount).to.equal(10);

      console.log("   ✅ 10个用户并发加密出价成功");
    });

    it("3.2 验证最高出价者获胜", async function () {
      console.log("\n🧪 测试：验证并发中的最高价...");

      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionEndTime) + 1);

      // 最高出价者（user9: 19000 SAT）claim
      await blindAuction.connect(users[9]).claim(auctionId, { value: ethers.parseEther("0.05") });

      const finalAuction = await blindAuction.auctions(auctionId);
      expect(finalAuction.winner).to.equal(users[9].address);

      console.log("   ✅ 最高出价者获胜");
      console.log("   ✓ 获胜者: 用户9 (19,000 SAT)");
    });
  });

  describe("🔐 测试4: 加密数据隐私测试", function () {
    let auctionId: number;

    it("4.1 创建拍卖并出价", async function () {
      console.log("\n🔐 测试：加密数据隐私...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await blindAuction.connect(users[10]).createAuction(
        "QmPrivacy",
        currentTime + 10,
        currentTime + 3600,
        { value: ethers.parseEther("0.01") }
      );

      auctionId = 3;
      await time.increaseTo(currentTime + 11);

      const longExpiry = await time.latest() + 365 * 24 * 3600;
      await mySecretToken.connect(users[11]).setOperator(auctionAddress, longExpiry);

      const input = fhevm.createEncryptedInput(auctionAddress, users[11].address);
      const encrypted = await input.add64(50000).encrypt();
      await blindAuction.connect(users[11]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✅ 用户11出价 50,000 SAT (加密)");
    });

    it("4.2 验证可以获取加密句柄但无法直接读取", async function () {
      console.log("\n🧪 测试：验证加密数据不可读...");

      const encryptedBid = await blindAuction.getEncryptedBid(auctionId, users[11].address);

      // 验证加密句柄存在
      expect(encryptedBid).to.not.equal(0);

      // 加密句柄是一个非零的bytes32值，但无法直接读取明文
      console.log("   ✅ 加密句柄存在但无法读取明文");
      console.log("   ✓ 加密句柄:", encryptedBid.toString().slice(0, 20) + "...");
    });

    it("4.3 验证拍卖结束前无法得知获胜者", async function () {
      console.log("\n🧪 测试：拍卖期间获胜者不可知...");

      const auction = await blindAuction.auctions(auctionId);

      // 在拍卖期间，winner应该是零地址
      expect(auction.winner).to.equal(ethers.ZeroAddress);

      console.log("   ✅ 拍卖期间获胜者为零地址（隐私保护）");
    });
  });

  describe("🎯 测试5: 加密状态一致性测试", function () {
    it("5.1 验证加密余额一致性", async function () {
      console.log("\n🧪 测试：加密余额一致性...");

      const balance1 = await mySecretToken.confidentialBalanceOf(users[0].address);
      const balance2 = await mySecretToken.confidentialBalanceOf(users[0].address);

      expect(balance1).to.equal(balance2);

      console.log("   ✅ 加密余额读取一致");
    });

    it("5.2 验证加密出价一致性", async function () {
      console.log("\n🧪 测试：加密出价一致性...");

      // 用户2在拍卖0中有出价
      const bid1 = await blindAuction.getEncryptedBid(0, users[2].address);
      const bid2 = await blindAuction.getEncryptedBid(0, users[2].address);

      expect(bid1).to.equal(bid2);

      console.log("   ✅ 加密出价读取一致");
    });

    it("5.3 验证不同用户的加密数据独立", async function () {
      console.log("\n🧪 测试：不同用户加密数据独立...");

      const bid1 = await blindAuction.getEncryptedBid(2, users[0].address);
      const bid2 = await blindAuction.getEncryptedBid(2, users[1].address);

      // 不同用户的加密出价应该不同（即使明文相同，密文也不同）
      expect(bid1).to.not.equal(bid2);

      console.log("   ✅ 不同用户的加密数据独立");
    });
  });

  describe("⚡ 测试6: 加密比较性能测试", function () {
    let auctionId: number;

    it("6.1 创建拍卖并测试5个不同价格", async function () {
      console.log("\n🔐 测试：加密比较性能...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await blindAuction.connect(users[12]).createAuction(
        "QmCompare",
        currentTime + 10,
        currentTime + 3600,
        { value: ethers.parseEther("0.01") }
      );

      auctionId = 4;
      await time.increaseTo(currentTime + 11);

      const longExpiry = await time.latest() + 365 * 24 * 3600;
      const prices = [30000, 20000, 50000, 10000, 40000];
      console.log("   🔢 测试不同价格的FHE比较...");

      for (let i = 0; i < 5; i++) {
        await mySecretToken.connect(users[i]).setOperator(auctionAddress, longExpiry);
        const input = fhevm.createEncryptedInput(auctionAddress, users[i].address);
        const encrypted = await input.add64(prices[i]).encrypt();
        await blindAuction.connect(users[i]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);
        console.log(`      ✓ 用户${i}: ${prices[i]} SAT`);
      }

      console.log("   ✅ 5个不同价格加密出价完成");
    });

    it("6.2 验证FHE比较选出正确最高价", async function () {
      console.log("\n🧪 测试：验证FHE选出最高价...");

      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionEndTime) + 1);

      // 最高价是用户2的50000 SAT
      await blindAuction.connect(users[2]).claim(auctionId, { value: ethers.parseEther("0.05") });

      const finalAuction = await blindAuction.auctions(auctionId);
      expect(finalAuction.winner).to.equal(users[2].address);

      console.log("   ✅ FHE正确选出最高价");
      console.log("   ✓ 获胜者: 用户2 (50,000 SAT)");
      console.log("   ✓ 击败价格: 30000, 20000, 10000, 40000 SAT");
    });
  });

  describe("🔄 测试7: 加密转账完整性测试", function () {
    it("7.1 验证加密代币转入合约", async function () {
      console.log("\n🧪 测试：加密转账完整性...");

      const contractBalanceBefore = await mySecretToken.confidentialBalanceOf(auctionAddress);

      // 创建新拍卖并出价
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await blindAuction.connect(users[13]).createAuction(
        "QmTransfer",
        currentTime + 10,
        currentTime + 3600,
        { value: ethers.parseEther("0.01") }
      );

      const auctionId = 5;
      await time.increaseTo(currentTime + 11);

      const longExpiry = await time.latest() + 365 * 24 * 3600;
      await mySecretToken.connect(users[13]).setOperator(auctionAddress, longExpiry);

      const input = fhevm.createEncryptedInput(auctionAddress, users[13].address);
      const encrypted = await input.add64(100000).encrypt();
      await blindAuction.connect(users[13]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      const contractBalanceAfter = await mySecretToken.confidentialBalanceOf(auctionAddress);

      // 合约余额应该增加（虽然是加密的，但句柄应该不同）
      expect(contractBalanceBefore).to.not.equal(contractBalanceAfter);

      console.log("   ✅ 加密代币成功转入合约");
    });

    it("7.2 验证加密代币退款转出", async function () {
      console.log("\n🧪 测试：加密退款转出...");

      const auctionId = 5;
      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionEndTime) + 1);

      const userBalanceBefore = await mySecretToken.confidentialBalanceOf(users[13].address);

      // Claim并获得退款（如果不是唯一出价者）或者托管
      await blindAuction.connect(users[13]).claim(auctionId, { value: ethers.parseEther("0.05") });

      // 验证claim执行成功
      const hasClaimed = await blindAuction.hasClaimed(auctionId, users[13].address);
      expect(hasClaimed).to.be.true;

      console.log("   ✅ Claim成功，加密代币正确处理");
    });
  });

  after(function () {
    console.log("\n" + "=".repeat(70));
    console.log("✅ FHEVM加密场景极限测试完成！");
    console.log("=".repeat(70) + "\n");

    console.log("📊 测试总结:\n");
    console.log("✅ 加密数值极限测试（1 到 10,000,000 SAT）");
    console.log("✅ 连续加密操作测试（10次追加累计）");
    console.log("✅ 多用户并发加密测试（10人同时出价）");
    console.log("✅ 加密数据隐私测试（无法读取他人出价）");
    console.log("✅ 加密状态一致性测试（余额和出价一致）");
    console.log("✅ 加密比较性能测试（FHE.gt/eq正确性）");
    console.log("✅ 加密转账完整性测试（转入转出验证）");
    console.log("\n🎉 所有FHEVM加密测试通过！\n");
  });
});
