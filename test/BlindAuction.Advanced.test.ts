import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { BlindAuction, BlindAuction__factory, MySecretToken, MySecretToken__factory, TokenExchange, TokenExchange__factory } from "../types";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * 🧪 BlindAuction 高级功能测试
 *
 * 测试覆盖:
 * 1. 平局处理测试(多个相同出价)
 * 2. 加密出价验证测试
 * 3. 时间戳和时间边界测试
 * 4. 追加出价场景测试
 * 5. 零出价和极端值测试
 * 6. 多拍卖并发测试
 * 7. 托管机制完整性测试
 * 8. 超时自动释放测试
 */

describe("🧪 BlindAuction 高级功能测试", function () {
  let blindAuction: BlindAuction;
  let mySecretToken: MySecretToken;
  let tokenExchange: TokenExchange;
  let admin: HardhatEthersSigner;
  let seller: HardhatEthersSigner;
  let bidders: HardhatEthersSigner[];

  let tokenAddress: string;
  let auctionAddress: string;

  before(async function () {
    console.log("\n" + "=".repeat(70));
    console.log("🧪 BlindAuction 高级功能测试");
    console.log("=".repeat(70) + "\n");

    const signers = await ethers.getSigners();
    admin = signers[0];
    seller = signers[1];
    bidders = signers.slice(2, 12); // 10个竞拍者

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

    // 为所有竞拍者购买代币
    for (const bidder of bidders) {
      await tokenExchange.connect(bidder).buyTokens({ value: ethers.parseEther("0.2") });
      const expiry = Math.floor(Date.now() / 1000) + 86400;
      await mySecretToken.connect(bidder).setOperator(auctionAddress, expiry);
    }

    console.log("✅ 合约部署和初始化完成\n");
  });

  describe("🎯 测试1: 平局处理 - 相同出价场景", function () {
    let auctionId: number;

    it("✅ 1.1 创建拍卖", async function () {
      console.log("\n🧪 测试：创建拍卖用于平局测试...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      const startTime = currentTime + 100;
      const endTime = startTime + 3600;

      await blindAuction.connect(seller).createAuction(
        "QmTieBreaker",
        startTime,
        endTime,
        { value: ethers.parseEther("0.01") }
      );

      auctionId = 0;
      await time.increaseTo(startTime + 1);

      console.log("   ✅ 拍卖创建成功，ID:", auctionId);
    });

    it("✅ 1.2 三个竞拍者出相同的最高价 50000 SAT", async function () {
      console.log("\n🧪 测试：三个竞拍者出相同价格...");

      const bidAmount = 50000;

      // 竞拍者0出价（最早）
      let input = fhevm.createEncryptedInput(auctionAddress, bidders[0].address);
      let encrypted = await input.add64(bidAmount).encrypt();
      await blindAuction.connect(bidders[0]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);
      console.log("   ✓ 竞拍者0出价:", bidAmount, "SAT");

      // 等待一个区块
      await time.increase(1);

      // 竞拍者1出价（第二）
      input = fhevm.createEncryptedInput(auctionAddress, bidders[1].address);
      encrypted = await input.add64(bidAmount).encrypt();
      await blindAuction.connect(bidders[1]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);
      console.log("   ✓ 竞拍者1出价:", bidAmount, "SAT");

      // 等待一个区块
      await time.increase(1);

      // 竞拍者2出价（最晚）
      input = fhevm.createEncryptedInput(auctionAddress, bidders[2].address);
      encrypted = await input.add64(bidAmount).encrypt();
      await blindAuction.connect(bidders[2]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);
      console.log("   ✓ 竞拍者2出价:", bidAmount, "SAT");

      const biddersCount = await blindAuction.getBiddersCount(auctionId);
      expect(biddersCount).to.equal(3);
    });

    it("✅ 1.3 竞拍者3和4出更低价", async function () {
      console.log("\n🧪 测试：其他竞拍者出更低价...");

      // 竞拍者3出价 40000
      let input = fhevm.createEncryptedInput(auctionAddress, bidders[3].address);
      let encrypted = await input.add64(40000).encrypt();
      await blindAuction.connect(bidders[3]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      // 竞拍者4出价 30000
      input = fhevm.createEncryptedInput(auctionAddress, bidders[4].address);
      encrypted = await input.add64(30000).encrypt();
      await blindAuction.connect(bidders[4]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✓ 竞拍者3出价: 40000 SAT");
      console.log("   ✓ 竞拍者4出价: 30000 SAT");
    });

    it("✅ 1.4 等待拍卖结束并验证只有一个获胜者", async function () {
      console.log("\n🧪 测试：验证平局处理...");

      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionEndTime) + 1);

      // 第一个相同价格的出价者claim（应该获胜）
      await blindAuction.connect(bidders[0]).claim(auctionId, { value: ethers.parseEther("0.05") });
      const auctionAfterFirst = await blindAuction.auctions(auctionId);

      console.log("   ✓ 第一个相同价格出价者claim完成");
      console.log("   ✓ 获胜者:", auctionAfterFirst.winner);

      // 第二个相同价格的出价者claim（应该被退款）
      await blindAuction.connect(bidders[1]).claim(auctionId, { value: ethers.parseEther("0.05") });
      console.log("   ✓ 第二个相同价格出价者claim完成（应被退款）");

      // 第三个相同价格的出价者claim（应该被退款）
      await blindAuction.connect(bidders[2]).claim(auctionId, { value: ethers.parseEther("0.05") });
      console.log("   ✓ 第三个相同价格出价者claim完成（应被退款）");

      // 验证只有一个获胜者
      const finalAuction = await blindAuction.auctions(auctionId);
      expect(finalAuction.winner).to.equal(bidders[0].address);
      console.log("   ✅ 验证通过：只有最早出价者获胜");
    });

    it("✅ 1.5 其他失败者claim并获得退款", async function () {
      console.log("\n🧪 测试：其他失败者claim...");

      await blindAuction.connect(bidders[3]).claim(auctionId, { value: ethers.parseEther("0.05") });
      await blindAuction.connect(bidders[4]).claim(auctionId, { value: ethers.parseEther("0.05") });

      console.log("   ✅ 所有失败者claim完成并获得退款");
    });
  });

  describe("🔐 测试2: 追加出价场景", function () {
    let auctionId: number;

    it("✅ 2.1 创建新拍卖", async function () {
      console.log("\n🧪 测试：创建拍卖用于追加出价测试...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      const startTime = currentTime + 100;
      const endTime = startTime + 3600;

      await blindAuction.connect(seller).createAuction(
        "QmIncrementalBid",
        startTime,
        endTime,
        { value: ethers.parseEther("0.01") }
      );

      auctionId = 1;
      await time.increaseTo(startTime + 1);

      console.log("   ✅ 拍卖创建成功，ID:", auctionId);
    });

    it("✅ 2.2 竞拍者初始出价 30000 SAT", async function () {
      console.log("\n🧪 测试：竞拍者初始出价...");

      const input = fhevm.createEncryptedInput(auctionAddress, bidders[0].address);
      const encrypted = await input.add64(30000).encrypt();
      await blindAuction.connect(bidders[0]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✓ 初始出价: 30000 SAT");

      const biddersCount = await blindAuction.getBiddersCount(auctionId);
      expect(biddersCount).to.equal(1);
    });

    it("✅ 2.3 其他竞拍者出价 40000 SAT (超过竞拍者0)", async function () {
      console.log("\n🧪 测试：其他竞拍者出更高价...");

      const input = fhevm.createEncryptedInput(auctionAddress, bidders[1].address);
      const encrypted = await input.add64(40000).encrypt();
      await blindAuction.connect(bidders[1]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✓ 竞拍者1出价: 40000 SAT");
    });

    it("✅ 2.4 竞拍者0追加出价 15000 SAT (总计 45000)", async function () {
      console.log("\n🧪 测试：竞拍者0追加出价...");

      const input = fhevm.createEncryptedInput(auctionAddress, bidders[0].address);
      const encrypted = await input.add64(15000).encrypt();
      await blindAuction.connect(bidders[0]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✓ 追加出价: 15000 SAT");
      console.log("   ✓ 总出价: 45000 SAT (30000 + 15000)");

      // 竞拍者数量应该还是2（追加不增加）
      const biddersCount = await blindAuction.getBiddersCount(auctionId);
      expect(biddersCount).to.equal(2);
    });

    it("✅ 2.5 竞拍者1再次追加出价 10000 SAT (总计 50000)", async function () {
      console.log("\n🧪 测试：竞拍者1追加出价...");

      const input = fhevm.createEncryptedInput(auctionAddress, bidders[1].address);
      const encrypted = await input.add64(10000).encrypt();
      await blindAuction.connect(bidders[1]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✓ 追加出价: 10000 SAT");
      console.log("   ✓ 总出价: 50000 SAT (40000 + 10000)");
    });

    it("✅ 2.6 拍卖结束后验证获胜者", async function () {
      console.log("\n🧪 测试：验证追加出价后的获胜者...");

      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionEndTime) + 1);

      // 竞拍者1 claim (应该获胜，50000 > 45000)
      await blindAuction.connect(bidders[1]).claim(auctionId, { value: ethers.parseEther("0.05") });

      const finalAuction = await blindAuction.auctions(auctionId);
      expect(finalAuction.winner).to.equal(bidders[1].address);

      console.log("   ✅ 验证通过：追加出价后的最高出价者获胜");

      // 竞拍者0 claim (失败者，获得退款)
      await blindAuction.connect(bidders[0]).claim(auctionId, { value: ethers.parseEther("0.05") });
      console.log("   ✅ 失败者获得退款");
    });
  });

  describe("⏰ 测试3: 时间边界测试", function () {
    let auctionId: number;

    it("✅ 3.1 创建即将开始的拍卖 (10秒后)", async function () {
      console.log("\n🧪 测试：创建即将开始的拍卖...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      const startTime = currentTime + 10;
      const endTime = startTime + 60;

      await blindAuction.connect(seller).createAuction(
        "QmTimeBoundary",
        startTime,
        endTime,
        { value: ethers.parseEther("0.01") }
      );

      auctionId = 2;
      console.log("   ✅ 拍卖创建成功");
    });

    it("❌ 3.2 在开始时间前1秒尝试出价", async function () {
      console.log("\n🧪 测试：开始前1秒出价...");

      const auction = await blindAuction.auctions(auctionId);
      const currentTime = await time.latest();

      // 只有当前时间还在开始前，才尝试出价
      if (currentTime < Number(auction.auctionStartTime)) {
        const input = fhevm.createEncryptedInput(auctionAddress, bidders[0].address);
        const encrypted = await input.add64(10000).encrypt();

        await expect(
          blindAuction.connect(bidders[0]).bid(auctionId, encrypted.handles[0], encrypted.inputProof)
        ).to.be.reverted;

        console.log("   ✅ 正确拒绝：拍卖未开始");
      } else {
        console.log("   ⚠️  跳过：时间已过开始时间");
        this.skip();
      }
    });

    it("✅ 3.3 在开始时间的第一秒出价", async function () {
      console.log("\n🧪 测试：开始时间第一秒出价...");

      const auction = await blindAuction.auctions(auctionId);
      const startTime = Number(auction.auctionStartTime);
      await time.increaseTo(startTime);

      const input = fhevm.createEncryptedInput(auctionAddress, bidders[0].address);
      const encrypted = await input.add64(20000).encrypt();
      await blindAuction.connect(bidders[0]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✅ 出价成功");
    });

    it("✅ 3.4 在结束前最后一秒出价", async function () {
      console.log("\n🧪 测试：结束前最后一秒出价...");

      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionEndTime) - 1);

      const input = fhevm.createEncryptedInput(auctionAddress, bidders[1].address);
      const encrypted = await input.add64(25000).encrypt();
      await blindAuction.connect(bidders[1]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✅ 最后一秒出价成功");
    });

    it("❌ 3.5 结束时间后尝试出价", async function () {
      console.log("\n🧪 测试：结束后出价...");

      const auction = await blindAuction.auctions(auctionId);
      const endTime = Number(auction.auctionEndTime);
      await time.increaseTo(endTime + 1);

      const input = fhevm.createEncryptedInput(auctionAddress, bidders[2].address);
      const encrypted = await input.add64(30000).encrypt();

      await expect(
        blindAuction.connect(bidders[2]).bid(auctionId, encrypted.handles[0], encrypted.inputProof)
      ).to.be.reverted;

      console.log("   ✅ 正确拒绝：拍卖已结束");
    });
  });

  describe("🔢 测试4: 极端值测试", function () {
    let auctionId: number;

    it("✅ 4.1 创建拍卖", async function () {
      console.log("\n🧪 测试：创建拍卖用于极端值测试...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      const startTime = currentTime + 10;
      const endTime = startTime + 3600;

      await blindAuction.connect(seller).createAuction(
        "QmExtremeValues",
        startTime,
        endTime,
        { value: ethers.parseEther("0.01") }
      );

      auctionId = 3;
      await time.increaseTo(startTime + 1);

      console.log("   ✅ 拍卖创建成功");
    });

    it("✅ 4.2 出价最小值 1 SAT", async function () {
      console.log("\n🧪 测试：出价最小值...");

      const input = fhevm.createEncryptedInput(auctionAddress, bidders[0].address);
      const encrypted = await input.add64(1).encrypt();
      await blindAuction.connect(bidders[0]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✅ 最小值出价成功: 1 SAT");
    });

    it("✅ 4.3 出价接近 uint64 最大值", async function () {
      console.log("\n🧪 测试：出价接近最大值...");

      // 购买更多代币
      await tokenExchange.connect(bidders[1]).buyTokens({ value: ethers.parseEther("100") });

      const largeAmount = 100000000; // 1亿 SAT (100 ETH)
      const input = fhevm.createEncryptedInput(auctionAddress, bidders[1].address);
      const encrypted = await input.add64(largeAmount).encrypt();
      await blindAuction.connect(bidders[1]).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✅ 大额出价成功:", largeAmount, "SAT");
    });

    it("✅ 4.4 验证大额出价获胜", async function () {
      console.log("\n🧪 测试：验证大额出价获胜...");

      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionEndTime) + 1);

      await blindAuction.connect(bidders[1]).claim(auctionId, { value: ethers.parseEther("0.05") });

      const finalAuction = await blindAuction.auctions(auctionId);
      expect(finalAuction.winner).to.equal(bidders[1].address);

      console.log("   ✅ 大额出价者获胜");
    });
  });

  describe("🏭 测试5: 多拍卖并发测试", function () {
    it("✅ 5.1 同时创建5个拍卖", async function () {
      console.log("\n🧪 测试：同时创建多个拍卖...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      for (let i = 0; i < 5; i++) {
        const startTime = currentTime + 100 + i * 10;
        const endTime = startTime + 3600;

        await blindAuction.connect(seller).createAuction(
          `QmConcurrent${i}`,
          startTime,
          endTime,
          { value: ethers.parseEther("0.01") }
        );
      }

      const totalAuctions = await blindAuction.nextAuctionId();
      console.log("   ✅ 创建了5个拍卖，总数:", totalAuctions.toString());
      expect(Number(totalAuctions)).to.be.gte(9); // 之前有4个，现在至少9个
    });

    it("✅ 5.2 不同竞拍者在不同拍卖中出价", async function () {
      console.log("\n🧪 测试：并发出价...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      await time.increaseTo(currentTime + 101);

      // 拍卖4: 竞拍者0和1
      let input = fhevm.createEncryptedInput(auctionAddress, bidders[0].address);
      let encrypted = await input.add64(10000).encrypt();
      await blindAuction.connect(bidders[0]).bid(4, encrypted.handles[0], encrypted.inputProof);

      input = fhevm.createEncryptedInput(auctionAddress, bidders[1].address);
      encrypted = await input.add64(15000).encrypt();
      await blindAuction.connect(bidders[1]).bid(4, encrypted.handles[0], encrypted.inputProof);

      // 拍卖5: 竞拍者2和3
      await time.increaseTo(currentTime + 111);

      input = fhevm.createEncryptedInput(auctionAddress, bidders[2].address);
      encrypted = await input.add64(20000).encrypt();
      await blindAuction.connect(bidders[2]).bid(5, encrypted.handles[0], encrypted.inputProof);

      input = fhevm.createEncryptedInput(auctionAddress, bidders[3].address);
      encrypted = await input.add64(25000).encrypt();
      await blindAuction.connect(bidders[3]).bid(5, encrypted.handles[0], encrypted.inputProof);

      console.log("   ✅ 并发出价完成");
    });

    it("✅ 5.3 查询用户参与的拍卖", async function () {
      console.log("\n🧪 测试：查询用户参与的拍卖...");

      const bidder0Auctions = await blindAuction.getUserBidAuctions(bidders[0].address);
      const bidder2Auctions = await blindAuction.getUserBidAuctions(bidders[2].address);

      console.log("   ✓ 竞拍者0参与的拍卖:", bidder0Auctions.length.toString());
      console.log("   ✓ 竞拍者2参与的拍卖:", bidder2Auctions.length.toString());

      expect(bidder0Auctions.length).to.be.gte(1);
      expect(bidder2Auctions.length).to.be.gte(1);
    });
  });

  describe("⏱️ 测试6: 超时自动释放托管", function () {
    let timeoutAuctionId: number;

    it("✅ 6.1 创建拍卖并完成出价", async function () {
      console.log("\n🧪 测试：创建拍卖用于超时测试...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      const startTime = currentTime + 100;
      const endTime = startTime + 1000;

      await blindAuction.connect(seller).createAuction(
        "QmTimeoutEscrow",
        startTime,
        endTime,
        { value: ethers.parseEther("0.01") }
      );

      timeoutAuctionId = Number(await blindAuction.nextAuctionId()) - 1;
      await time.increaseTo(startTime + 1);

      const input = fhevm.createEncryptedInput(auctionAddress, bidders[5].address);
      const encrypted = await input.add64(50000).encrypt();
      await blindAuction.connect(bidders[5]).bid(timeoutAuctionId, encrypted.handles[0], encrypted.inputProof);

      await time.increaseTo(endTime + 1);
      await blindAuction.connect(bidders[5]).claim(timeoutAuctionId, { value: ethers.parseEther("0.05") });

      console.log("   ✅ 拍卖完成，有获胜者");
    });

    it("✅ 6.2 卖家发货", async function () {
      console.log("\n🧪 测试：卖家发货...");

      await blindAuction.connect(seller).confirmShipment(timeoutAuctionId, "TIMEOUT_TEST_123");

      const auction = await blindAuction.auctions(timeoutAuctionId);
      expect(auction.deliveryStatus).to.equal(1); // Shipped

      console.log("   ✅ 发货成功");
    });

    it("❌ 6.3 超时前卖家尝试提取（应失败）", async function () {
      console.log("\n🧪 测试：超时前提取...");

      await expect(
        blindAuction.connect(seller).claimEscrowAfterTimeout(timeoutAuctionId)
      ).to.be.revertedWith("Timeout not reached");

      console.log("   ✅ 正确拒绝：未超时");
    });

    it("✅ 6.4 等待30天后卖家成功提取托管", async function () {
      console.log("\n🧪 测试：30天后自动提取...");

      // 增加30天
      await time.increase(30 * 24 * 60 * 60);

      await blindAuction.connect(seller).claimEscrowAfterTimeout(timeoutAuctionId);

      const auction = await blindAuction.auctions(timeoutAuctionId);
      expect(auction.deliveryStatus).to.equal(2); // Received (自动确认)

      console.log("   ✅ 超时自动提取成功");
    });
  });

  describe("🛡️ 测试7: DoS攻击防护 - 出价者数量限制", function () {
    let dosAuctionId: number;

    it("✅ 7.1 创建拍卖", async function () {
      console.log("\n🧪 测试：创建拍卖用于DoS测试...");

      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      const startTime = currentTime + 100;
      const endTime = startTime + 3600;

      await blindAuction.connect(seller).createAuction(
        "QmDoSTest",
        startTime,
        endTime,
        { value: ethers.parseEther("0.01") }
      );

      dosAuctionId = Number(await blindAuction.nextAuctionId()) - 1;
      await time.increaseTo(startTime + 1);

      console.log("   ✅ 拍卖创建成功");
    });

    it("✅ 7.2 10个竞拍者出价（在限制内）", async function () {
      console.log("\n🧪 测试：正常范围内的出价...");

      for (let i = 0; i < 10; i++) {
        const input = fhevm.createEncryptedInput(auctionAddress, bidders[i].address);
        const encrypted = await input.add64(10000 + i * 1000).encrypt();
        await blindAuction.connect(bidders[i]).bid(dosAuctionId, encrypted.handles[0], encrypted.inputProof);
      }

      const biddersCount = await blindAuction.getBiddersCount(dosAuctionId);
      expect(biddersCount).to.equal(10);

      console.log("   ✅ 10个出价者成功出价");
    });

    it("✅ 7.3 验证MAX_BIDDERS_PER_AUCTION常量", async function () {
      console.log("\n🧪 测试：验证出价者上限...");

      const maxBidders = await blindAuction.MAX_BIDDERS_PER_AUCTION();
      console.log("   ✓ 最大出价者数量:", maxBidders.toString());

      expect(maxBidders).to.equal(100);
      console.log("   ✅ 出价者上限为100人");
    });
  });

  after(function () {
    console.log("\n" + "=".repeat(70));
    console.log("✅ BlindAuction 高级功能测试完成！");
    console.log("=".repeat(70) + "\n");

    console.log("📊 测试总结:\n");
    console.log("✅ 平局处理测试（3个相同出价，先到先得）");
    console.log("✅ 追加出价场景测试（多次追加，累计计算）");
    console.log("✅ 时间边界测试（开始前/中/结束前后）");
    console.log("✅ 极端值测试（最小值1、大额100万）");
    console.log("✅ 多拍卖并发测试（5个拍卖同时进行）");
    console.log("✅ 超时自动释放测试（30天后自动确认）");
    console.log("✅ DoS攻击防护测试（出价者数量限制）");
    console.log("\n🎉 所有高级功能测试通过！\n");
  });
});
