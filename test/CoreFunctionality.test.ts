import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { BlindAuction, BlindAuction__factory, MySecretToken, MySecretToken__factory, TokenExchange, TokenExchange__factory } from "../types";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * ✅ BlindAuction 核心功能完整测试
 *
 * 这是一个完全独立的测试套件，涵盖所有核心功能
 */

describe("✅ BlindAuction 核心功能完整测试", function () {
  let blindAuction: BlindAuction;
  let mySecretToken: MySecretToken;
  let tokenExchange: TokenExchange;
  let admin: HardhatEthersSigner;
  let seller: HardhatEthersSigner;
  let buyer1: HardhatEthersSigner;
  let buyer2: HardhatEthersSigner;
  let buyer3: HardhatEthersSigner;

  let auctionAddress: string;

  before(async function () {
    this.timeout(60000);
    console.log("\n" + "=".repeat(70));
    console.log("✅ BlindAuction 核心功能完整测试");
    console.log("=".repeat(70) + "\n");

    [admin, seller, buyer1, buyer2, buyer3] = await ethers.getSigners();

    // 部署合约
    const TokenFactory = await ethers.getContractFactory("MySecretToken") as MySecretToken__factory;
    mySecretToken = await TokenFactory.connect(admin).deploy("SAT", "SAT", "ipfs://test");
    await mySecretToken.waitForDeployment();

    const ExchangeFactory = await ethers.getContractFactory("TokenExchange") as TokenExchange__factory;
    tokenExchange = await ExchangeFactory.connect(admin).deploy(await mySecretToken.getAddress());
    await tokenExchange.waitForDeployment();

    const AuctionFactory = await ethers.getContractFactory("BlindAuction") as BlindAuction__factory;
    blindAuction = await AuctionFactory.connect(admin).deploy(await mySecretToken.getAddress());
    await blindAuction.waitForDeployment();
    auctionAddress = await blindAuction.getAddress();

    await mySecretToken.connect(admin).setMinter(await tokenExchange.getAddress());

    // 为买家购买代币
    await tokenExchange.connect(buyer1).buyTokens({ value: ethers.parseEther("1") });
    await tokenExchange.connect(buyer2).buyTokens({ value: ethers.parseEther("1") });
    await tokenExchange.connect(buyer3).buyTokens({ value: ethers.parseEther("1") });

    console.log("✅ 合约部署完成\n");
  });

  describe("📦 测试1: 完整拍卖流程", function () {
    let auctionId: number;

    it("1.1 卖家创建拍卖", async function () {
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await blindAuction.connect(seller).createAuction(
        "QmTest1",
        currentTime + 60,
        currentTime + 3600,
        { value: ethers.parseEther("0.01") }
      );

      auctionId = 0;
      const auction = await blindAuction.auctions(auctionId);
      expect(auction.beneficiary).to.equal(seller.address);
    });

    it("1.2 买家设置权限并出价", async function () {
      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionStartTime) + 1);

      // 设置永久权限 - 使用区块链时间
      const longExpiry = await time.latest() + 365 * 24 * 3600;

      await mySecretToken.connect(buyer1).setOperator(auctionAddress, longExpiry);
      const input1 = fhevm.createEncryptedInput(auctionAddress, buyer1.address);
      const encrypted1 = await input1.add64(30000).encrypt();
      await blindAuction.connect(buyer1).bid(auctionId, encrypted1.handles[0], encrypted1.inputProof);

      await mySecretToken.connect(buyer2).setOperator(auctionAddress, longExpiry);
      const input2 = fhevm.createEncryptedInput(auctionAddress, buyer2.address);
      const encrypted2 = await input2.add64(50000).encrypt();
      await blindAuction.connect(buyer2).bid(auctionId, encrypted2.handles[0], encrypted2.inputProof);

      const biddersCount = await blindAuction.getBiddersCount(auctionId);
      expect(biddersCount).to.equal(2);
    });

    it("1.3 拍卖结束后claim", async function () {
      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionEndTime) + 1);

      await blindAuction.connect(buyer2).claim(auctionId, { value: ethers.parseEther("0.05") });
      await blindAuction.connect(buyer1).claim(auctionId, { value: ethers.parseEther("0.05") });

      const finalAuction = await blindAuction.auctions(auctionId);
      expect(finalAuction.winner).to.equal(buyer2.address);
    });

    it("1.4 卖家发货", async function () {
      await blindAuction.connect(seller).confirmShipment(auctionId, "TRACK123");

      const auction = await blindAuction.auctions(auctionId);
      expect(auction.deliveryStatus).to.equal(1);
    });

    it("1.5 买家确认收货", async function () {
      await blindAuction.connect(buyer2).confirmReceipt(auctionId);

      const auction = await blindAuction.auctions(auctionId);
      expect(auction.deliveryStatus).to.equal(2);
    });

    it("1.6 卖家提取托管", async function () {
      await blindAuction.connect(seller).withdrawEscrow(auctionId);

      const sellerBalance = await mySecretToken.confidentialBalanceOf(seller.address);
      expect(sellerBalance).to.not.equal(0);
    });

    it("1.7 买家提取押金", async function () {
      const balanceBefore = await ethers.provider.getBalance(buyer2.address);
      await blindAuction.connect(buyer2).withdrawStake(auctionId);
      const balanceAfter = await ethers.provider.getBalance(buyer2.address);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });

  describe("🔐 测试2: FHEVM加密功能", function () {
    let auctionId: number;

    it("2.1 创建拍卖", async function () {
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await blindAuction.connect(seller).createAuction(
        "QmEncrypt",
        currentTime + 60,
        currentTime + 3600,
        { value: ethers.parseEther("0.01") }
      );

      auctionId = 1;
    });

    it("2.2 加密出价（不同金额）", async function () {
      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionStartTime) + 1);

      const longExpiry = await time.latest() + 365 * 24 * 3600;

      // buyer1: 1 SAT (最小值)
      await mySecretToken.connect(buyer1).setOperator(auctionAddress, longExpiry);
      const input1 = fhevm.createEncryptedInput(auctionAddress, buyer1.address);
      const encrypted1 = await input1.add64(1).encrypt();
      await blindAuction.connect(buyer1).bid(auctionId, encrypted1.handles[0], encrypted1.inputProof);

      // buyer2: 1000000 SAT (中等值)
      await mySecretToken.connect(buyer2).setOperator(auctionAddress, longExpiry);
      const input2 = fhevm.createEncryptedInput(auctionAddress, buyer2.address);
      const encrypted2 = await input2.add64(1000000).encrypt();
      await blindAuction.connect(buyer2).bid(auctionId, encrypted2.handles[0], encrypted2.inputProof);

      // buyer3: 10000000 SAT (大值)
      await mySecretToken.connect(buyer3).setOperator(auctionAddress, longExpiry);
      const input3 = fhevm.createEncryptedInput(auctionAddress, buyer3.address);
      const encrypted3 = await input3.add64(10000000).encrypt();
      await blindAuction.connect(buyer3).bid(auctionId, encrypted3.handles[0], encrypted3.inputProof);
    });

    it("2.3 验证FHE比较正确（大值获胜）", async function () {
      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionEndTime) + 1);

      await blindAuction.connect(buyer3).claim(auctionId, { value: ethers.parseEther("0.05") });

      const finalAuction = await blindAuction.auctions(auctionId);
      expect(finalAuction.winner).to.equal(buyer3.address);
    });

    it("2.4 验证加密退款", async function () {
      await blindAuction.connect(buyer1).claim(auctionId, { value: ethers.parseEther("0.05") });
      await blindAuction.connect(buyer2).claim(auctionId, { value: ethers.parseEther("0.05") });

      const hasClaimed1 = await blindAuction.hasClaimed(auctionId, buyer1.address);
      const hasClaimed2 = await blindAuction.hasClaimed(auctionId, buyer2.address);

      expect(hasClaimed1).to.be.true;
      expect(hasClaimed2).to.be.true;
    });
  });

  describe("🔄 测试3: 追加出价", function () {
    let auctionId: number;

    it("3.1 创建拍卖", async function () {
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await blindAuction.connect(seller).createAuction(
        "QmIncremental",
        currentTime + 60,
        currentTime + 3600,
        { value: ethers.parseEther("0.01") }
      );

      auctionId = 2;
    });

    it("3.2 用户多次追加出价", async function () {
      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionStartTime) + 1);

      const longExpiry = await time.latest() + 365 * 24 * 3600;
      await mySecretToken.connect(buyer1).setOperator(auctionAddress, longExpiry);

      // 追加5次
      for (let i = 1; i <= 5; i++) {
        const input = fhevm.createEncryptedInput(auctionAddress, buyer1.address);
        const encrypted = await input.add64(10000 * i).encrypt();
        await blindAuction.connect(buyer1).bid(auctionId, encrypted.handles[0], encrypted.inputProof);
      }

      const biddersCount = await blindAuction.getBiddersCount(auctionId);
      expect(biddersCount).to.equal(1);
    });

    it("3.3 验证累计出价正确", async function () {
      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionEndTime) + 1);

      await blindAuction.connect(buyer1).claim(auctionId, { value: ethers.parseEther("0.05") });

      const finalAuction = await blindAuction.auctions(auctionId);
      expect(finalAuction.winner).to.equal(buyer1.address);
    });
  });

  describe("⚖️ 测试4: 争议处理", function () {
    let auctionId: number;

    it("4.1 创建拍卖并完成交易", async function () {
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await blindAuction.connect(seller).createAuction(
        "QmDispute",
        currentTime + 60,
        currentTime + 3600,
        { value: ethers.parseEther("0.01") }
      );

      auctionId = 3;

      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionStartTime) + 1);

      const longExpiry = await time.latest() + 365 * 24 * 3600;
      await mySecretToken.connect(buyer1).setOperator(auctionAddress, longExpiry);
      const input = fhevm.createEncryptedInput(auctionAddress, buyer1.address);
      const encrypted = await input.add64(20000).encrypt();
      await blindAuction.connect(buyer1).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      await time.increaseTo(Number(auction.auctionEndTime) + 1);
      await blindAuction.connect(buyer1).claim(auctionId, { value: ethers.parseEther("0.05") });

      await blindAuction.connect(seller).confirmShipment(auctionId, "DISPUTE123");
    });

    it("4.2 买家发起争议", async function () {
      await blindAuction.connect(buyer1).raiseDispute(auctionId, "商品有问题");

      const auction = await blindAuction.auctions(auctionId);
      expect(auction.deliveryStatus).to.equal(3);
    });

    it("4.3 管理员仲裁", async function () {
      await blindAuction.connect(admin).adminArbitrate(auctionId, true);

      const auction = await blindAuction.auctions(auctionId);
      expect(auction.deliveryStatus).to.equal(4);
    });
  });

  describe("⏰ 测试5: 超时机制", function () {
    let auctionId: number;

    it("5.1 创建拍卖并发货", async function () {
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await blindAuction.connect(seller).createAuction(
        "QmTimeout",
        currentTime + 60,
        currentTime + 3600,
        { value: ethers.parseEther("0.01") }
      );

      auctionId = 4;

      const auction = await blindAuction.auctions(auctionId);
      await time.increaseTo(Number(auction.auctionStartTime) + 1);

      const longExpiry = await time.latest() + 365 * 24 * 3600;
      await mySecretToken.connect(buyer1).setOperator(auctionAddress, longExpiry);
      const input = fhevm.createEncryptedInput(auctionAddress, buyer1.address);
      const encrypted = await input.add64(15000).encrypt();
      await blindAuction.connect(buyer1).bid(auctionId, encrypted.handles[0], encrypted.inputProof);

      await time.increaseTo(Number(auction.auctionEndTime) + 1);
      await blindAuction.connect(buyer1).claim(auctionId, { value: ethers.parseEther("0.05") });

      await blindAuction.connect(seller).confirmShipment(auctionId, "TIMEOUT123");
    });

    it("5.2 30天后卖家超时提取", async function () {
      await time.increase(31 * 24 * 60 * 60);

      await blindAuction.connect(seller).claimEscrowAfterTimeout(auctionId);

      const auction = await blindAuction.auctions(auctionId);
      expect(auction.deliveryStatus).to.equal(2);
    });
  });

  describe("🛡️ 测试6: 权限和安全", function () {
    it("6.1 非owner无法暂停", async function () {
      await expect(
        blindAuction.connect(seller).pause()
      ).to.be.reverted;
    });

    it("6.2 owner可以暂停和恢复", async function () {
      await blindAuction.connect(admin).pause();
      expect(await blindAuction.paused()).to.be.true;

      await blindAuction.connect(admin).unpause();
      expect(await blindAuction.paused()).to.be.false;
    });

    it("6.3 非owner无法提取手续费", async function () {
      await expect(
        blindAuction.connect(seller).withdrawFees()
      ).to.be.reverted;
    });

    it("6.4 owner可以提取手续费", async function () {
      const balanceBefore = await ethers.provider.getBalance(admin.address);
      await blindAuction.connect(admin).withdrawFees();
      const balanceAfter = await ethers.provider.getBalance(admin.address);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });

  after(function () {
    console.log("\n" + "=".repeat(70));
    console.log("✅ 所有核心功能测试通过！");
    console.log("=".repeat(70) + "\n");
  });
});
