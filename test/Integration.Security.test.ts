import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { BlindAuction, BlindAuction__factory, MySecretToken, MySecretToken__factory, TokenExchange, TokenExchange__factory } from "../types";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("🛡️ 集成安全性测试", function () {
  let blindAuction: BlindAuction;
  let mySecretToken: MySecretToken;
  let tokenExchange: TokenExchange;
  let admin: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let users: HardhatEthersSigner[];

  before(async function () {
    const signers = await ethers.getSigners();
    admin = signers[0];
    attacker = signers[1];
    users = signers.slice(2, 8);

    const TokenFactory = await ethers.getContractFactory("MySecretToken") as MySecretToken__factory;
    mySecretToken = await TokenFactory.connect(admin).deploy("SAT", "SAT", "ipfs://test");
    await mySecretToken.waitForDeployment();

    const ExchangeFactory = await ethers.getContractFactory("TokenExchange") as TokenExchange__factory;
    tokenExchange = await ExchangeFactory.connect(admin).deploy(await mySecretToken.getAddress());
    await tokenExchange.waitForDeployment();

    const AuctionFactory = await ethers.getContractFactory("BlindAuction") as BlindAuction__factory;
    blindAuction = await AuctionFactory.connect(admin).deploy(await mySecretToken.getAddress());
    await blindAuction.waitForDeployment();

    await mySecretToken.connect(admin).setMinter(await tokenExchange.getAddress());

    const currentTime = await time.latest();
    const longExpiry = currentTime + 365 * 24 * 3600;

    for (const user of users) {
      await tokenExchange.connect(user).buyTokens({ value: ethers.parseEther("1") });
      await mySecretToken.connect(user).setOperator(
        await blindAuction.getAddress(),
        longExpiry
      );
    }
  });

  describe("🔒 重入攻击防护测试", function () {
    it("1. Claim不能重入", async function () {
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      await blindAuction.connect(users[0]).createAuction(
        "QmReentrancy",
        currentTime + 10,
        currentTime + 100,
        { value: ethers.parseEther("0.01") }
      );
      await time.increaseTo(currentTime + 11);

      const auctionAddress = await blindAuction.getAddress();
      const input = fhevm.createEncryptedInput(auctionAddress, users[1].address);
      const encrypted = await input.add64(10000).encrypt();
      await blindAuction.connect(users[1]).bid(0, encrypted.handles[0], encrypted.inputProof);

      await time.increaseTo(currentTime + 101);
      await blindAuction.connect(users[1]).claim(0, { value: ethers.parseEther("0.05") });

      await expect(
        blindAuction.connect(users[1]).claim(0, { value: ethers.parseEther("0.05") })
      ).to.be.revertedWith("Already claimed");
    });

    it("2. WithdrawStake不能重入", async function () {
      await blindAuction.connect(users[1]).withdrawStake(0);

      await expect(
        blindAuction.connect(users[1]).withdrawStake(0)
      ).to.be.revertedWith("No stake to withdraw");
    });
  });

  describe("🚫 未授权访问测试", function () {
    it("1. 非owner无法暂停合约", async function () {
      await expect(
        blindAuction.connect(attacker).pause()
      ).to.be.reverted;
    });

    it("2. 非owner无法提取手续费", async function () {
      await expect(
        blindAuction.connect(attacker).withdrawFees()
      ).to.be.reverted;
    });

    it("3. 非卖家无法确认发货", async function () {
      await expect(
        blindAuction.connect(attacker).confirmShipment(0, "FAKE")
      ).to.be.reverted;
    });

    it("4. 非买家无法确认收货", async function () {
      await expect(
        blindAuction.connect(attacker).confirmReceipt(0)
      ).to.be.reverted;
    });
  });

  describe("💣 DoS攻击防护测试", function () {
    it("1. 出价者数量限制", async function () {
      const maxBidders = await blindAuction.MAX_BIDDERS_PER_AUCTION();
      expect(maxBidders).to.equal(100);
    });

    it("2. Gas限制保护", async function () {
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      await blindAuction.connect(users[0]).createAuction(
        "QmGasTest",
        currentTime + 10,
        currentTime + 1000,
        { value: ethers.parseEther("0.01") }
      );
      await time.increaseTo(currentTime + 11);

      for (let i = 0; i < 6; i++) {
        const auctionAddress = await blindAuction.getAddress();
        const input = fhevm.createEncryptedInput(auctionAddress, users[i].address);
        const encrypted = await input.add64(10000 + i).encrypt();
        await blindAuction.connect(users[i]).bid(1, encrypted.handles[0], encrypted.inputProof);
      }

      const biddersCount = await blindAuction.getBiddersCount(1);
      expect(biddersCount).to.equal(6);
    });
  });

  describe("⚡ 前端运行攻击防护", function () {
    it("1. 时间戳操纵保护", async function () {
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await expect(
        blindAuction.connect(users[0]).createAuction(
          "QmFrontRun",
          currentTime - 100,
          currentTime + 1000,
          { value: ethers.parseEther("0.01") }
        )
      ).to.be.revertedWith("Start time cannot be in the past");
    });

    it("2. 结束时间验证", async function () {
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await expect(
        blindAuction.connect(users[0]).createAuction(
          "QmBadTime",
          currentTime + 1000,
          currentTime + 100,
          { value: ethers.parseEther("0.01") }
        )
      ).to.be.revertedWith("Invalid time");
    });
  });

  describe("🔐 数据完整性测试", function () {
    it("1. 空元数据拒绝", async function () {
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await expect(
        blindAuction.connect(users[0]).createAuction(
          "",
          currentTime + 100,
          currentTime + 1000,
          { value: ethers.parseEther("0.01") }
        )
      ).to.be.revertedWith("Metadata CID required");
    });

    it("2. 空物流信息拒绝", async function () {
      await expect(
        blindAuction.connect(users[0]).confirmShipment(0, "")
      ).to.be.revertedWith("Tracking info cannot be empty");
    });

    it("3. 空争议原因拒绝", async function () {
      await expect(
        blindAuction.connect(users[1]).raiseDispute(0, "")
      ).to.be.revertedWith("Dispute reason cannot be empty");
    });
  });

  describe("💰 支付安全测试", function () {
    it("1. 上架费不足拒绝", async function () {
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;

      await expect(
        blindAuction.connect(users[0]).createAuction(
          "QmLowFee",
          currentTime + 100,
          currentTime + 1000,
          { value: ethers.parseEther("0.005") }
        )
      ).to.be.revertedWith("Insufficient listing fee");
    });

    it("2. 押金不足拒绝", async function () {
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock!.timestamp;
      await blindAuction.connect(users[0]).createAuction(
        "QmStakeTest",
        currentTime + 10,
        currentTime + 100,
        { value: ethers.parseEther("0.01") }
      );
      await time.increaseTo(currentTime + 11);

      const auctionAddress = await blindAuction.getAddress();
      const input = fhevm.createEncryptedInput(auctionAddress, users[2].address);
      const encrypted = await input.add64(5000).encrypt();
      await blindAuction.connect(users[2]).bid(2, encrypted.handles[0], encrypted.inputProof);

      await time.increaseTo(currentTime + 101);

      await expect(
        blindAuction.connect(users[2]).claim(2, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Must stake 0.05 ETH");
    });
  });
});
