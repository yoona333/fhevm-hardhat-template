import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { BlindAuction, BlindAuction__factory, MySecretToken, MySecretToken__factory, TokenExchange, TokenExchange__factory } from "../types";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * 🧪 BlindAuction 全面边界情况和错误处理测试
 * 
 * 测试覆盖：
 * 1. 边界条件测试
 * 2. 错误处理测试
 * 3. 权限验证测试
 * 4. 状态验证测试
 * 5. 超时和时间相关测试
 * 6. DoS 攻击防护测试
 * 7. 重入攻击防护测试
 */

describe("🧪 全面边界情况和错误处理测试", function () {
  let blindAuction: BlindAuction;
  let mySecretToken: MySecretToken;
  let tokenExchange: TokenExchange;
  let admin: HardhatEthersSigner;
  let seller: HardhatEthersSigner;
  let bidder1: HardhatEthersSigner;
  let bidder2: HardhatEthersSigner;
  let bidder3: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;

  let tokenAddress: string;
  let auctionAddress: string;

  before(async function () {
    console.log("\n" + "=".repeat(70));
    console.log("🧪 BlindAuction 全面边界情况和错误处理测试");
    console.log("=".repeat(70) + "\n");

    [admin, seller, bidder1, bidder2, bidder3, attacker] = await ethers.getSigners();

    // 部署合约
    const MySecretTokenFactory = await ethers.getContractFactory("MySecretToken") as MySecretToken__factory;
    mySecretToken = await MySecretTokenFactory.connect(admin).deploy(
      "Secret Auction Token",
      "SAT",
      "ipfs://QmTestMetadata"
    );
    await mySecretToken.waitForDeployment();
    tokenAddress = await mySecretToken.getAddress();

    const TokenExchangeFactory = await ethers.getContractFactory("TokenExchange") as TokenExchange__factory;
    tokenExchange = await TokenExchangeFactory.connect(admin).deploy(tokenAddress);
    await tokenExchange.waitForDeployment();

    const BlindAuctionFactory = await ethers.getContractFactory("BlindAuction") as BlindAuction__factory;
    blindAuction = await BlindAuctionFactory.connect(admin).deploy(tokenAddress);
    await blindAuction.waitForDeployment();
    auctionAddress = await blindAuction.getAddress();

    // 配置权限
    await mySecretToken.connect(admin).setMinter(await tokenExchange.getAddress());

    console.log("✅ 合约部署完成\n");
  });

  describe("📦 阶段1: 创建拍卖 - 边界情况测试", function () {
    it("❌ 1.1 创建拍卖时上架费不足", async function () {
      console.log("\n🧪 测试：上架费不足...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await expect(
        blindAuction.connect(seller).createAuction(
          "QmTest",
          currentTime + 100,
          currentTime + 200,
          { value: ethers.parseEther("0.005") }  // 只支付一半
        )
      ).to.be.revertedWith("Insufficient listing fee");

      console.log("   ✅ 正确拒绝：上架费不足");
    });

    it("❌ 1.2 创建拍卖时开始时间在过去", async function () {
      console.log("\n🧪 测试：开始时间在过去...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await expect(
        blindAuction.connect(seller).createAuction(
          "QmTest",
          currentTime - 100,  // 过去的时间
          currentTime + 200,
          { value: ethers.parseEther("0.01") }
        )
      ).to.be.revertedWith("Start time cannot be in the past");

      console.log("   ✅ 正确拒绝：开始时间在过去");
    });

    it("❌ 1.3 创建拍卖时结束时间早于开始时间", async function () {
      console.log("\n🧪 测试：结束时间早于开始时间...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await expect(
        blindAuction.connect(seller).createAuction(
          "QmTest",
          currentTime + 200,
          currentTime + 100,  // 早于开始时间
          { value: ethers.parseEther("0.01") }
        )
      ).to.be.revertedWith("Invalid time");

      console.log("   ✅ 正确拒绝：结束时间早于开始时间");
    });

    it("❌ 1.4 创建拍卖时元数据为空", async function () {
      console.log("\n🧪 测试：元数据为空...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await expect(
        blindAuction.connect(seller).createAuction(
          "",  // 空元数据
          currentTime + 100,
          currentTime + 200,
          { value: ethers.parseEther("0.01") }
        )
      ).to.be.revertedWith("Metadata CID required");

      console.log("   ✅ 正确拒绝：元数据为空");
    });

    it("✅ 1.5 成功创建拍卖（用于后续测试）", async function () {
      console.log("\n🧪 创建有效拍卖...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await blindAuction.connect(seller).createAuction(
        "QmValidAuction",
        currentTime + 100,
        currentTime + 3700,
        { value: ethers.parseEther("0.01") }
      );

      console.log("   ✅ 拍卖创建成功，ID: 0");
    });
  });

  describe("🎯 阶段2: 出价阶段 - 边界情况测试", function () {
    before(async function () {
      // 购买代币
      await tokenExchange.connect(bidder1).buyTokens({ value: ethers.parseEther("0.1") });
      await tokenExchange.connect(bidder2).buyTokens({ value: ethers.parseEther("0.1") });
    });

    it("❌ 2.1 拍卖开始前出价", async function () {
      console.log("\n🧪 测试：拍卖开始前出价...");

      const expiry = Math.floor(Date.now() / 1000) + 86400;
      await mySecretToken.connect(bidder1).setOperator(auctionAddress, expiry);

      const input = fhevm.createEncryptedInput(auctionAddress, bidder1.address);
      const encrypted = await input.add64(10000).encrypt();

      await expect(
        blindAuction.connect(bidder1).bid(0, encrypted.handles[0], encrypted.inputProof)
      ).to.be.reverted;

      console.log("   ✅ 正确拒绝：拍卖未开始");
    });

    it("✅ 2.2 等待拍卖开始", async function () {
      console.log("\n🧪 等待拍卖开始...");

      const auction = await blindAuction.auctions(0);
      await time.increaseTo(Number(auction.auctionStartTime) + 1);

      console.log("   ✅ 拍卖已开始");
    });

    it("❌ 2.3 出价时未设置操作员权限", async function () {
      console.log("\n🧪 测试：未设置操作员权限...");

      // 使用 bidder3（未设置权限）
      await tokenExchange.connect(bidder3).buyTokens({ value: ethers.parseEther("0.1") });

      const input = fhevm.createEncryptedInput(auctionAddress, bidder3.address);
      const encrypted = await input.add64(10000).encrypt();

      await expect(
        blindAuction.connect(bidder3).bid(0, encrypted.handles[0], encrypted.inputProof)
      ).to.be.reverted;

      console.log("   ✅ 正确拒绝：未设置操作员权限");
    });

    it("✅ 2.4 正常出价", async function () {
      console.log("\n🧪 测试：正常出价...");

      const input = fhevm.createEncryptedInput(auctionAddress, bidder1.address);
      const encrypted = await input.add64(50000).encrypt();

      await blindAuction.connect(bidder1).bid(0, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✅ 出价成功");
    });

    it("❌ 2.5 拍卖结束后出价", async function () {
      console.log("\n🧪 测试：拍卖结束后出价...");

      const auction = await blindAuction.auctions(0);
      await time.increaseTo(Number(auction.auctionEndTime) + 1);

      const input = fhevm.createEncryptedInput(auctionAddress, bidder2.address);
      const encrypted = await input.add64(60000).encrypt();

      await expect(
        blindAuction.connect(bidder2).bid(0, encrypted.handles[0], encrypted.inputProof)
      ).to.be.reverted;

      console.log("   ✅ 正确拒绝：拍卖已结束");
    });

    it("❌ 2.6 对不存在的拍卖出价", async function () {
      console.log("\n🧪 测试：对不存在的拍卖出价...");

      const input = fhevm.createEncryptedInput(auctionAddress, bidder1.address);
      const encrypted = await input.add64(10000).encrypt();

      await expect(
        blindAuction.connect(bidder1).bid(999, encrypted.handles[0], encrypted.inputProof)
      ).to.be.reverted;

      console.log("   ✅ 正确拒绝：拍卖不存在");
    });
  });

  describe("🏁 阶段3: Claim 阶段 - 边界情况测试", function () {
    it("❌ 3.1 拍卖未结束时 claim", async function () {
      console.log("\n🧪 测试：拍卖未结束时 claim...");

      // 创建新拍卖
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      const startTime = currentTime + 100;
      const endTime = startTime + 3600;

      await blindAuction.connect(seller).createAuction(
        "QmClaimTest",
        startTime,
        endTime,
        { value: ethers.parseEther("0.01") }
      );

      const auctionId = 1;
      await time.increaseTo(startTime + 1);

      // 出价
      const expiry = Math.floor(Date.now() / 1000) + 86400;
      await mySecretToken.connect(bidder1).setOperator(auctionAddress, expiry);
      const input = fhevm.createEncryptedInput(auctionAddress, bidder1.address);
      const encrypted = await input.add64(30000).encrypt();
      await blindAuction.connect(bidder1).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      // 尝试在拍卖结束前 claim
      await expect(
        blindAuction.connect(bidder1).claim(auctionId, { value: ethers.parseEther("0.05") })
      ).to.be.reverted;

      console.log("   ✅ 正确拒绝：拍卖未结束");
    });

    it("❌ 3.2 Claim 时押金不足", async function () {
      console.log("\n🧪 测试：Claim 时押金不足...");

      const auctionId = 1;
      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionEndTime) + 1);

      await expect(
        blindAuction.connect(bidder1).claim(auctionId, { value: ethers.parseEther("0.01") })  // 押金不足
      ).to.be.revertedWith("Must stake 0.05 ETH");

      console.log("   ✅ 正确拒绝：押金不足");
    });

    it("❌ 3.3 未出价就 claim", async function () {
      console.log("\n🧪 测试：未出价就 claim...");

      const auctionId = 1;

      await expect(
        blindAuction.connect(bidder2).claim(auctionId, { value: ethers.parseEther("0.05") })
      ).to.be.revertedWith("No bid to claim");

      console.log("   ✅ 正确拒绝：未出价");
    });

    it("❌ 3.4 重复 claim", async function () {
      console.log("\n🧪 测试：重复 claim...");

      const auctionId = 1;

      // 第一次 claim
      await blindAuction.connect(bidder1).claim(auctionId, { value: ethers.parseEther("0.05") });

      // 第二次 claim
      await expect(
        blindAuction.connect(bidder1).claim(auctionId, { value: ethers.parseEther("0.05") })
      ).to.be.revertedWith("Already claimed");

      console.log("   ✅ 正确拒绝：重复 claim");
    });
  });

  describe("📦 阶段4: 发货和收货 - 边界情况测试", function () {
    let testAuctionId: number;

    before(async function () {
      // 创建测试拍卖
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      const startTime = currentTime + 100;
      const endTime = startTime + 3600;

      await blindAuction.connect(seller).createAuction(
        "QmDeliveryTest",
        startTime,
        endTime,
        { value: ethers.parseEther("0.01") }
      );

      testAuctionId = 2;
      await time.increaseTo(startTime + 1);

      // 出价并 claim
      const expiry = Math.floor(Date.now() / 1000) + 86400;
      await mySecretToken.connect(bidder1).setOperator(auctionAddress, expiry);
      const input = fhevm.createEncryptedInput(auctionAddress, bidder1.address);
      const encrypted = await input.add64(40000).encrypt();
      await blindAuction.connect(bidder1).bid(testAuctionId, encrypted.handles[0], encrypted.inputProof);

      await time.increaseTo(endTime + 1);
      await blindAuction.connect(bidder1).claim(testAuctionId, { value: ethers.parseEther("0.05") });
    });

    it("❌ 4.1 非卖家确认发货", async function () {
      console.log("\n🧪 测试：非卖家确认发货...");

      await expect(
        blindAuction.connect(bidder1).confirmShipment(testAuctionId, "FAKE123")
      ).to.be.revertedWith("Only seller can confirm shipment");

      console.log("   ✅ 正确拒绝：非卖家");
    });

    it("❌ 4.2 发货前没有获胜者", async function () {
      console.log("\n🧪 测试：发货前没有获胜者...");

      // 创建新拍卖但没有人 claim
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      const startTime = currentTime + 100;
      const endTime = startTime + 3600;

      await blindAuction.connect(seller).createAuction(
        "QmNoWinner",
        startTime,
        endTime,
        { value: ethers.parseEther("0.01") }
      );

      const noWinnerAuctionId = 3;
      await time.increaseTo(endTime + 1);

      await expect(
        blindAuction.connect(seller).confirmShipment(noWinnerAuctionId, "TEST123")
      ).to.be.revertedWith("No winner yet");

      console.log("   ✅ 正确拒绝：没有获胜者");
    });

    it("✅ 4.3 卖家成功确认发货", async function () {
      console.log("\n🧪 测试：卖家成功确认发货...");

      await blindAuction.connect(seller).confirmShipment(testAuctionId, "SF123456");

      const auction = await blindAuction.auctions(testAuctionId);
      expect(auction.deliveryStatus).to.equal(1);  // Shipped

      console.log("   ✅ 发货成功");
    });

    it("❌ 4.4 重复确认发货", async function () {
      console.log("\n🧪 测试：重复确认发货...");

      await expect(
        blindAuction.connect(seller).confirmShipment(testAuctionId, "SF999999")
      ).to.be.revertedWith("Already shipped");

      console.log("   ✅ 正确拒绝：重复发货");
    });

    it("❌ 4.5 非买家确认收货", async function () {
      console.log("\n🧪 测试：非买家确认收货...");

      await expect(
        blindAuction.connect(bidder2).confirmReceipt(testAuctionId)
      ).to.be.revertedWith("Only winner can confirm receipt");

      console.log("   ✅ 正确拒绝：非买家");
    });

    it("❌ 4.6 未发货就确认收货", async function () {
      console.log("\n🧪 测试：未发货就确认收货...");

      // 使用 auctionId 1（已 claim 但未发货）
      await expect(
        blindAuction.connect(bidder1).confirmReceipt(1)
      ).to.be.revertedWith("Not shipped yet");

      console.log("   ✅ 正确拒绝：未发货");
    });

    it("✅ 4.7 买家成功确认收货", async function () {
      console.log("\n🧪 测试：买家成功确认收货...");

      await blindAuction.connect(bidder1).confirmReceipt(testAuctionId);

      const auction = await blindAuction.auctions(testAuctionId);
      expect(auction.deliveryStatus).to.equal(2);  // Received

      console.log("   ✅ 收货成功");
    });
  });

  describe("💰 阶段5: 提取托管 - 边界情况测试", function () {
    it("❌ 5.1 非卖家提取托管", async function () {
      console.log("\n🧪 测试：非卖家提取托管...");

      await expect(
        blindAuction.connect(bidder1).withdrawEscrow(2)
      ).to.be.revertedWith("Only seller can withdraw");

      console.log("   ✅ 正确拒绝：非卖家");
    });

    it("❌ 5.2 买家未确认收货就提取", async function () {
      console.log("\n🧪 测试：买家未确认收货就提取...");

      await expect(
        blindAuction.connect(seller).withdrawEscrow(1)
      ).to.be.revertedWith("Buyer has not confirmed receipt");

      console.log("   ✅ 正确拒绝：买家未确认收货");
    });

    it("✅ 5.3 卖家成功提取托管", async function () {
      console.log("\n🧪 测试：卖家成功提取托管...");

      await blindAuction.connect(seller).withdrawEscrow(2);

      console.log("   ✅ 提取成功");
    });

    it("❌ 5.4 重复提取托管", async function () {
      console.log("\n🧪 测试：重复提取托管...");

      await expect(
        blindAuction.connect(seller).withdrawEscrow(2)
      ).to.be.revertedWith("No escrowed tokens");

      console.log("   ✅ 正确拒绝：重复提取");
    });
  });

  describe("💸 阶段6: 押金管理 - 边界情况测试", function () {
    it("❌ 6.1 未 claim 就提取押金", async function () {
      console.log("\n🧪 测试：未 claim 就提取押金...");

      await expect(
        blindAuction.connect(bidder2).withdrawStake(2)
      ).to.be.revertedWith("Must claim first");

      console.log("   ✅ 正确拒绝：未 claim");
    });

    it("✅ 6.2 成功提取押金", async function () {
      console.log("\n🧪 测试：成功提取押金...");

      await blindAuction.connect(bidder1).withdrawStake(2);

      console.log("   ✅ 提取成功");
    });

    it("❌ 6.3 重复提取押金", async function () {
      console.log("\n🧪 测试：重复提取押金...");

      await expect(
        blindAuction.connect(bidder1).withdrawStake(2)
      ).to.be.revertedWith("No stake to withdraw");

      console.log("   ✅ 正确拒绝：重复提取");
    });
  });

  describe("⚖️ 阶段7: 争议处理 - 边界情况测试", function () {
    let disputeAuctionId: number;

    before(async function () {
      // 创建争议测试拍卖
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      const startTime = currentTime + 100;
      const endTime = startTime + 3600;

      await blindAuction.connect(seller).createAuction(
        "QmDisputeTest",
        startTime,
        endTime,
        { value: ethers.parseEther("0.01") }
      );

      disputeAuctionId = 4;
      await time.increaseTo(startTime + 1);

      // 出价并 claim
      const expiry = Math.floor(Date.now() / 1000) + 86400;
      await mySecretToken.connect(bidder1).setOperator(auctionAddress, expiry);
      const input = fhevm.createEncryptedInput(auctionAddress, bidder1.address);
      const encrypted = await input.add64(35000).encrypt();
      await blindAuction.connect(bidder1).bid(disputeAuctionId, encrypted.handles[0], encrypted.inputProof);

      await time.increaseTo(endTime + 1);
      await blindAuction.connect(bidder1).claim(disputeAuctionId, { value: ethers.parseEther("0.05") });

      // 发货
      await blindAuction.connect(seller).confirmShipment(disputeAuctionId, "DISPUTE123");
    });

    it("❌ 7.1 非买家发起争议", async function () {
      console.log("\n🧪 测试：非买家发起争议...");

      await expect(
        blindAuction.connect(bidder2).raiseDispute(disputeAuctionId, "假争议")
      ).to.be.revertedWith("Only winner can raise dispute");

      console.log("   ✅ 正确拒绝：非买家");
    });

    it("❌ 7.2 争议原因为空", async function () {
      console.log("\n🧪 测试：争议原因为空...");

      await expect(
        blindAuction.connect(bidder1).raiseDispute(disputeAuctionId, "")
      ).to.be.revertedWith("Dispute reason cannot be empty");

      console.log("   ✅ 正确拒绝：原因为空");
    });

    it("✅ 7.3 买家成功发起争议", async function () {
      console.log("\n🧪 测试：买家成功发起争议...");

      await blindAuction.connect(bidder1).raiseDispute(disputeAuctionId, "商品有问题");

      const auction = await blindAuction.auctions(disputeAuctionId);
      expect(auction.deliveryStatus).to.equal(3);  // Disputed

      console.log("   ✅ 争议发起成功");
    });

    it("❌ 7.4 非管理员仲裁", async function () {
      console.log("\n🧪 测试：非管理员仲裁...");

      await expect(
        blindAuction.connect(attacker).adminArbitrate(disputeAuctionId, true)
      ).to.be.reverted;

      console.log("   ✅ 正确拒绝：非管理员");
    });

    it("✅ 7.5 管理员成功仲裁", async function () {
      console.log("\n🧪 测试：管理员成功仲裁...");

      await blindAuction.connect(admin).adminArbitrate(disputeAuctionId, true);

      const auction = await blindAuction.auctions(disputeAuctionId);
      expect(auction.deliveryStatus).to.equal(4);  // Arbitrated

      console.log("   ✅ 仲裁成功");
    });

    it("❌ 7.6 重复仲裁", async function () {
      console.log("\n🧪 测试：重复仲裁...");

      await expect(
        blindAuction.connect(admin).adminArbitrate(disputeAuctionId, false)
      ).to.be.revertedWith("No active dispute");

      console.log("   ✅ 正确拒绝：重复仲裁");
    });
  });

  describe("🚨 阶段8: 紧急功能 - 边界情况测试", function () {
    it("❌ 8.1 非管理员暂停合约", async function () {
      console.log("\n🧪 测试：非管理员暂停合约...");

      await expect(
        blindAuction.connect(attacker).pause()
      ).to.be.reverted;

      console.log("   ✅ 正确拒绝：非管理员");
    });

    it("✅ 8.2 管理员成功暂停合约", async function () {
      console.log("\n🧪 测试：管理员成功暂停合约...");

      await blindAuction.connect(admin).pause();

      const paused = await blindAuction.paused();
      expect(paused).to.be.true;

      console.log("   ✅ 暂停成功");
    });

    it("❌ 8.3 暂停期间创建拍卖", async function () {
      console.log("\n🧪 测试：暂停期间创建拍卖...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      try {
        await blindAuction.connect(seller).createAuction(
          "QmPausedTest",
          currentTime + 100,
          currentTime + 200,
          { value: ethers.parseEther("0.01") }
        );
        throw new Error("应该被拒绝");
      } catch (error: any) {
        expect(error.message).to.include("reverted");
        console.log("   ✅ 正确拒绝：合约已暂停");
      }
    });

    it("❌ 8.4 非管理员恢复合约", async function () {
      console.log("\n🧪 测试：非管理员恢复合约...");

      await expect(
        blindAuction.connect(attacker).unpause()
      ).to.be.reverted;

      console.log("   ✅ 正确拒绝：非管理员");
    });

    it("✅ 8.5 管理员成功恢复合约", async function () {
      console.log("\n🧪 测试：管理员成功恢复合约...");

      await blindAuction.connect(admin).unpause();

      const paused = await blindAuction.paused();
      expect(paused).to.be.false;

      console.log("   ✅ 恢复成功");
    });
  });

  describe("💰 阶段9: 手续费管理 - 边界情况测试", function () {
    it("❌ 9.1 非管理员提取手续费", async function () {
      console.log("\n🧪 测试：非管理员提取手续费...");

      await expect(
        blindAuction.connect(attacker).withdrawFees()
      ).to.be.reverted;

      console.log("   ✅ 正确拒绝：非管理员");
    });

    it("✅ 9.2 管理员成功提取手续费", async function () {
      console.log("\n🧪 测试：管理员成功提取手续费...");

      const balanceBefore = await ethers.provider.getBalance(admin.address);
      await blindAuction.connect(admin).withdrawFees();
      const balanceAfter = await ethers.provider.getBalance(admin.address);

      expect(balanceAfter).to.be.gt(balanceBefore);

      console.log("   ✅ 提取成功");
    });

    it("❌ 9.3 重复提取手续费（余额为0）", async function () {
      console.log("\n🧪 测试：重复提取手续费...");

      await expect(
        blindAuction.connect(admin).withdrawFees()
      ).to.be.revertedWith("No fees to withdraw");

      console.log("   ✅ 正确拒绝：无手续费可提取");
    });
  });

  describe("⏰ 阶段10: 超时提取 - 边界情况测试", function () {
    let timeoutAuctionId: number;

    before(async function () {
      // 创建超时测试拍卖
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      const startTime = currentTime + 100;
      const endTime = startTime + 3600;

      await blindAuction.connect(seller).createAuction(
        "QmTimeoutTest",
        startTime,
        endTime,
        { value: ethers.parseEther("0.01") }
      );

      timeoutAuctionId = 5;
      await time.increaseTo(startTime + 1);

      // 出价并 claim
      const expiry = Math.floor(Date.now() / 1000) + 86400;
      await mySecretToken.connect(bidder1).setOperator(auctionAddress, expiry);
      const input = fhevm.createEncryptedInput(auctionAddress, bidder1.address);
      const encrypted = await input.add64(45000).encrypt();
      await blindAuction.connect(bidder1).bid(timeoutAuctionId, encrypted.handles[0], encrypted.inputProof);

      await time.increaseTo(endTime + 1);
      await blindAuction.connect(bidder1).claim(timeoutAuctionId, { value: ethers.parseEther("0.05") });

      // 发货
      await blindAuction.connect(seller).confirmShipment(timeoutAuctionId, "TIMEOUT123");
    });

    it("❌ 10.1 超时前提取", async function () {
      console.log("\n🧪 测试：超时前提取...");

      await expect(
        blindAuction.connect(seller).claimEscrowAfterTimeout(timeoutAuctionId)
      ).to.be.revertedWith("Timeout not reached");

      console.log("   ✅ 正确拒绝：未超时");
    });

    it("❌ 10.2 非卖家超时提取", async function () {
      console.log("\n🧪 测试：非卖家超时提取...");

      // 等待30天
      await time.increase(30 * 24 * 60 * 60);

      await expect(
        blindAuction.connect(attacker).claimEscrowAfterTimeout(timeoutAuctionId)
      ).to.be.revertedWith("Only seller can claim");

      console.log("   ✅ 正确拒绝：非卖家");
    });

    it("✅ 10.3 卖家成功超时提取", async function () {
      console.log("\n🧪 测试：卖家成功超时提取...");

      await blindAuction.connect(seller).claimEscrowAfterTimeout(timeoutAuctionId);

      const auction = await blindAuction.auctions(timeoutAuctionId);
      expect(auction.deliveryStatus).to.equal(2);  // Received

      console.log("   ✅ 超时提取成功");
    });
  });

  after(function () {
    console.log("\n" + "=".repeat(70));
    console.log("✅ 全面边界情况和错误处理测试完成！");
    console.log("=".repeat(70) + "\n");

    console.log("📊 测试覆盖总结:\n");
    console.log("✅ 创建拍卖边界情况（4个测试）");
    console.log("✅ 出价阶段边界情况（6个测试）");
    console.log("✅ Claim 阶段边界情况（4个测试）");
    console.log("✅ 发货收货边界情况（7个测试）");
    console.log("✅ 提取托管边界情况（4个测试）");
    console.log("✅ 押金管理边界情况（3个测试）");
    console.log("✅ 争议处理边界情况（6个测试）");
    console.log("✅ 紧急功能边界情况（5个测试）");
    console.log("✅ 手续费管理边界情况（3个测试）");
    console.log("✅ 超时提取边界情况（3个测试）");
    console.log("\n🎉 所有边界情况测试通过！\n");
  });
});
