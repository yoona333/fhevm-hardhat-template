/**
 * BlindAuction 完整测试套件（NFT 版本）
 *
 * 合约流程：
 *   createAuction（铸造 NFT）→ bid（加密出价）→ claim（确认获胜者）→ claimNFT（领取 NFT + 结算代币）
 *
 * 测试分组：
 *   1. 合约部署与基础配置
 *   2. 创建拍卖（含 NFT 铸造）
 *   3. 加密出价（FHEVM 核心）
 *   4. claim 逻辑（获胜者判定 + 平局处理）
 *   5. claimNFT（NFT 转移 + 代币结算）
 *   6. withdrawStake（押金退还）
 *   7. 费用管理
 *   8. 安全与权限
 *   9. ERC721 合规
 *  10. 完整端到端流程
 */

import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { BlindAuction, MySecretToken, TokenExchange } from "../types";

// ─── 常量 ────────────────────────────────────────────────────────────────────

const LISTING_FEE = ethers.parseEther("0.01");
const SUCCESS_FEE = ethers.parseEther("0.05");
const MINT_AMOUNT = 50_000_000n; // 每个测试账户的初始代币

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 部署三个合约并完成初始配置 */
async function deployAll() {
  const [admin, seller, bidder1, bidder2, bidder3] = await ethers.getSigners();

  const TokenFactory = await ethers.getContractFactory("MySecretToken");
  const mySecretToken = (await TokenFactory.deploy(
    "Secret Auction Token",
    "SAT",
    "ipfs://QmTokenMeta"
  )) as MySecretToken;
  const tokenAddress = await mySecretToken.getAddress();

  const ExchangeFactory = await ethers.getContractFactory("TokenExchange");
  const tokenExchange = (await ExchangeFactory.deploy(tokenAddress)) as TokenExchange;
  const exchangeAddress = await tokenExchange.getAddress();

  const AuctionFactory = await ethers.getContractFactory("BlindAuction");
  const blindAuction = (await AuctionFactory.deploy(
    tokenAddress,
    "BlindAuction NFT",
    "BANFT"
  )) as BlindAuction;
  const auctionAddress = await blindAuction.getAddress();

  // TokenExchange 设为 minter，铸造给测试账户
  await mySecretToken.setMinter(exchangeAddress);
  for (const bidder of [seller, bidder1, bidder2, bidder3]) {
    await mySecretToken.setMinter(admin.address);
    await mySecretToken.mint(bidder.address, MINT_AMOUNT);
  }
  // 恢复 minter 为 exchange
  await mySecretToken.setMinter(exchangeAddress);

  return {
    mySecretToken, tokenAddress,
    tokenExchange, exchangeAddress,
    blindAuction, auctionAddress,
    admin, seller, bidder1, bidder2, bidder3,
  };
}

/** 快速创建一个拍卖，返回 auctionId 和时间参数 */
async function createAuction(
  blindAuction: BlindAuction,
  seller: HardhatEthersSigner,
  opts: { metadataCID?: string; startDelay?: number; duration?: number; minimumBid?: bigint } = {}
) {
  const { metadataCID = "QmTest", startDelay = 60, duration = 300, minimumBid = 100n } = opts;
  const block = await ethers.provider.getBlock("latest");
  const startTime = block!.timestamp + startDelay;
  const endTime = startTime + duration;

  const tx = await blindAuction
    .connect(seller)
    .createAuction(metadataCID, startTime, endTime, minimumBid, { value: LISTING_FEE });
  await tx.wait();

  const auctionId = (await blindAuction.nextAuctionId()) - 1n;
  return { auctionId, startTime, endTime };
}

/** 授权并提交加密出价 */
async function placeBid(
  blindAuction: BlindAuction,
  mySecretToken: MySecretToken,
  bidder: HardhatEthersSigner,
  auctionAddress: string,
  auctionId: bigint,
  amount: bigint
) {
  const expiry = (await time.latest()) + 365 * 24 * 3600;
  await mySecretToken.connect(bidder).setOperator(auctionAddress, expiry);

  const input = fhevm.createEncryptedInput(auctionAddress, bidder.address);
  const encrypted = await input.add64(amount).encrypt();
  await blindAuction
    .connect(bidder)
    .bid(auctionId, encrypted.handles[0], encrypted.inputProof);
}

// ─── 测试套件 ────────────────────────────────────────────────────────────────

describe("BlindAuction 完整测试套件（NFT 版本）", function () {
  // ── 1. 合约部署与基础配置 ──────────────────────────────────────────────────

  describe("1. 合约部署与基础配置", function () {
    it("1.1 检查 FHEVM mock 环境", async function () {
      if (!fhevm.isMock) this.skip();
      expect(fhevm.isMock).to.be.true;
    });

    it("1.2 部署 MySecretToken 成功", async function () {
      if (!fhevm.isMock) this.skip();
      const { mySecretToken, admin } = await deployAll();
      expect(await mySecretToken.owner()).to.equal(admin.address);
    });

    it("1.3 部署 TokenExchange 成功，兑换率正确", async function () {
      if (!fhevm.isMock) this.skip();
      const { tokenExchange } = await deployAll();
      expect(await tokenExchange.getExchangeRate()).to.equal(1_000_000n);
    });

    it("1.4 部署 BlindAuction 成功，NFT 名称/符号正确", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction } = await deployAll();
      expect(await blindAuction.name()).to.equal("BlindAuction NFT");
      expect(await blindAuction.symbol()).to.equal("BANFT");
    });

    it("1.5 常量：LISTING_FEE = 0.01 ETH，SUCCESS_FEE = 0.05 ETH", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction } = await deployAll();
      expect(await blindAuction.LISTING_FEE()).to.equal(LISTING_FEE);
      expect(await blindAuction.SUCCESS_FEE()).to.equal(SUCCESS_FEE);
    });

    it("1.6 初始 auctionId = 0，合约未暂停", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction } = await deployAll();
      expect(await blindAuction.nextAuctionId()).to.equal(0n);
      expect(await blindAuction.paused()).to.be.false;
    });
  });

  // ── 2. 创建拍卖 ───────────────────────────────────────────────────────────

  describe("2. 创建拍卖（含 NFT 铸造）", function () {
    it("2.1 正常创建拍卖，触发 AuctionCreated 事件", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, seller } = await deployAll();
      const block = await ethers.provider.getBlock("latest");
      const startTime = block!.timestamp + 60;
      const endTime = startTime + 300;

      await expect(
        blindAuction
          .connect(seller)
          .createAuction("QmTest", startTime, endTime, 100n, { value: LISTING_FEE })
      )
        .to.emit(blindAuction, "AuctionCreated")
        .withArgs(0n, seller.address, "QmTest", startTime, endTime);
    });

    it("2.2 创建后 NFT 铸造给合约，tokenId = auctionId", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, auctionAddress, seller } = await deployAll();
      const { auctionId } = await createAuction(blindAuction, seller);

      const auction = await blindAuction.auctions(auctionId);
      expect(auction.nftTokenId).to.equal(auctionId);
      expect(await blindAuction.ownerOf(auctionId)).to.equal(auctionAddress);
      expect(auction.nftClaimed).to.be.false;
    });

    it("2.3 tokenURI 正确设置为 ipfs://<CID>", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, seller } = await deployAll();
      const { auctionId } = await createAuction(blindAuction, seller, { metadataCID: "QmABC123" });

      const uri = await blindAuction.tokenURI(auctionId);
      expect(uri).to.equal("ipfs://QmABC123");
    });

    it("2.4 创建多个拍卖，NFT ID 递增", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, auctionAddress, seller } = await deployAll();
      await createAuction(blindAuction, seller, { metadataCID: "QmA" });
      await createAuction(blindAuction, seller, { metadataCID: "QmB" });
      await createAuction(blindAuction, seller, { metadataCID: "QmC" });

      expect(await blindAuction.nextAuctionId()).to.equal(3n);
      for (let i = 0n; i < 3n; i++) {
        expect(await blindAuction.ownerOf(i)).to.equal(auctionAddress);
      }
    });

    it("2.5 不支付上架费则 revert", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, seller } = await deployAll();
      const block = await ethers.provider.getBlock("latest");
      const startTime = block!.timestamp + 60;
      const endTime = startTime + 300;

      await expect(
        blindAuction
          .connect(seller)
          .createAuction("QmTest", startTime, endTime, 100n, { value: 0n })
      ).to.be.revertedWith("Insufficient listing fee");
    });

    it("2.6 开始时间在过去则 revert", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, seller } = await deployAll();
      const block = await ethers.provider.getBlock("latest");
      const pastTime = block!.timestamp - 10;

      await expect(
        blindAuction
          .connect(seller)
          .createAuction("QmTest", pastTime, pastTime + 300, 100n, { value: LISTING_FEE })
      ).to.be.revertedWith("Start time cannot be in the past");
    });

    it("2.7 结束时间 <= 开始时间则 revert", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, seller } = await deployAll();
      const block = await ethers.provider.getBlock("latest");
      const startTime = block!.timestamp + 60;

      await expect(
        blindAuction
          .connect(seller)
          .createAuction("QmTest", startTime, startTime, 100n, { value: LISTING_FEE })
      ).to.be.revertedWith("Invalid time");
    });

    it("2.8 metadataCID 为空则 revert", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, seller } = await deployAll();
      const block = await ethers.provider.getBlock("latest");
      const startTime = block!.timestamp + 60;

      await expect(
        blindAuction
          .connect(seller)
          .createAuction("", startTime, startTime + 300, 100n, { value: LISTING_FEE })
      ).to.be.revertedWith("Metadata CID required");
    });

    it("2.9 minimumBid = 0 则 revert", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, seller } = await deployAll();
      const block = await ethers.provider.getBlock("latest");
      const startTime = block!.timestamp + 60;

      await expect(
        blindAuction
          .connect(seller)
          .createAuction("QmTest", startTime, startTime + 300, 0n, { value: LISTING_FEE })
      ).to.be.revertedWith("Minimum bid must be greater than 0");
    });

    it("2.10 合约暂停后创建拍卖 revert", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, admin, seller } = await deployAll();
      await blindAuction.connect(admin).pause();

      const block = await ethers.provider.getBlock("latest");
      const startTime = block!.timestamp + 60;

      await expect(
        blindAuction
          .connect(seller)
          .createAuction("QmTest", startTime, startTime + 300, 100n, { value: LISTING_FEE })
      ).to.be.reverted;

      await blindAuction.connect(admin).unpause();
    });

    it("2.11 getUserCreatedAuctions 正确记录", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, seller } = await deployAll();
      await createAuction(blindAuction, seller, { metadataCID: "QmA" });
      await createAuction(blindAuction, seller, { metadataCID: "QmB" });

      const ids = await blindAuction.getUserCreatedAuctions(seller.address);
      expect(ids.length).to.equal(2);
      expect(ids[0]).to.equal(0n);
      expect(ids[1]).to.equal(1n);
    });
  });

  // ── 3. 加密出价（FHEVM 核心） ────────────────────────────────────────────

  describe("3. 加密出价（FHEVM 核心）", function () {
    it("3.1 正常出价触发 BidPlaced 事件", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime } = await createAuction(blindAuction, seller);

      await time.increaseTo(startTime + 1);

      const expiry = (await time.latest()) + 3600;
      await mySecretToken.connect(bidder1).setOperator(auctionAddress, expiry);
      const enc = await fhevm.createEncryptedInput(auctionAddress, bidder1.address).add64(1000n).encrypt();

      await expect(
        blindAuction.connect(bidder1).bid(auctionId, enc.handles[0], enc.inputProof)
      )
        .to.emit(blindAuction, "BidPlaced")
        .withArgs(auctionId, bidder1.address);
    });

    it("3.2 拍卖开始前出价 revert（TooEarlyError）", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId } = await createAuction(blindAuction, seller);

      const expiry = (await time.latest()) + 3600;
      await mySecretToken.connect(bidder1).setOperator(auctionAddress, expiry);
      const enc = await fhevm.createEncryptedInput(auctionAddress, bidder1.address).add64(1000n).encrypt();

      await expect(
        blindAuction.connect(bidder1).bid(auctionId, enc.handles[0], enc.inputProof)
      ).to.be.reverted;
    });

    it("3.3 拍卖结束后出价 revert（TooLateError）", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, endTime } = await createAuction(blindAuction, seller);

      await time.increaseTo(endTime + 1);

      const expiry = (await time.latest()) + 3600;
      await mySecretToken.connect(bidder1).setOperator(auctionAddress, expiry);
      const enc = await fhevm.createEncryptedInput(auctionAddress, bidder1.address).add64(1000n).encrypt();

      await expect(
        blindAuction.connect(bidder1).bid(auctionId, enc.handles[0], enc.inputProof)
      ).to.be.reverted;
    });

    it("3.4 多人出价，getBiddersCount 正确", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1, bidder2, bidder3 } = await deployAll();
      const { auctionId, startTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);

      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 1000n);
      await placeBid(blindAuction, mySecretToken, bidder2, auctionAddress, auctionId, 2000n);
      await placeBid(blindAuction, mySecretToken, bidder3, auctionAddress, auctionId, 3000n);

      expect(await blindAuction.getBiddersCount(auctionId)).to.equal(3n);
    });

    it("3.5 同一用户追加出价，getBiddersCount 不增加", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);

      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 1000n);
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 2000n);
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 3000n);

      expect(await blindAuction.getBiddersCount(auctionId)).to.equal(1n);
    });

    it("3.6 出价后 getUserBidAuctions 正确记录", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);

      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 1000n);

      const bidAuctions = await blindAuction.getUserBidAuctions(bidder1.address);
      expect(bidAuctions.length).to.equal(1);
      expect(bidAuctions[0]).to.equal(auctionId);
    });

    it("3.7 出价后 getEncryptedBid 返回非零 handle", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);

      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 5000n);

      const handle = await blindAuction.getEncryptedBid(auctionId, bidder1.address);
      // handle 是 euint64，非零说明已初始化
      expect(handle).to.not.equal(0n);
    });

    it("3.8 不存在的拍卖 ID 出价 revert（AuctionNotFound）", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, bidder1 } = await deployAll();

      const expiry = (await time.latest()) + 3600;
      await mySecretToken.connect(bidder1).setOperator(auctionAddress, expiry);
      const enc = await fhevm.createEncryptedInput(auctionAddress, bidder1.address).add64(1000n).encrypt();

      await expect(
        blindAuction.connect(bidder1).bid(999n, enc.handles[0], enc.inputProof)
      ).to.be.reverted;
    });
  });

  // ── 4. claim 逻辑 ─────────────────────────────────────────────────────────

  describe("4. claim 逻辑（获胜者判定 + 平局处理）", function () {
    it("4.1 出价最高者 claim 后成为 winner", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1, bidder2 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);

      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 1000n);
      await placeBid(blindAuction, mySecretToken, bidder2, auctionAddress, auctionId, 5000n);

      await time.increaseTo(endTime + 1);

      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(bidder2).claim(auctionId, { value: SUCCESS_FEE });

      const auction = await blindAuction.auctions(auctionId);
      expect(auction.winner).to.equal(bidder2.address);
    });

    it("4.2 单个出价者 claim 直接成为 winner", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);

      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 3000n);
      await time.increaseTo(endTime + 1);

      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });

      const auction = await blindAuction.auctions(auctionId);
      expect(auction.winner).to.equal(bidder1.address);
    });

    it("4.3 claim 触发 Claimed 事件", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);

      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 3000n);
      await time.increaseTo(endTime + 1);

      await expect(blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE }))
        .to.emit(blindAuction, "Claimed")
        .withArgs(auctionId, bidder1.address);
    });

    it("4.4 拍卖未结束时 claim revert", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);

      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 3000n);

      await expect(
        blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE })
      ).to.be.reverted;
    });

    it("4.5 未出价者 claim revert", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1, bidder2 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);

      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 3000n);
      await time.increaseTo(endTime + 1);

      await expect(
        blindAuction.connect(bidder2).claim(auctionId, { value: SUCCESS_FEE })
      ).to.be.revertedWith("No bid to claim");
    });

    it("4.6 不支付押金 claim revert", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);

      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 3000n);
      await time.increaseTo(endTime + 1);

      await expect(
        blindAuction.connect(bidder1).claim(auctionId, { value: 0n })
      ).to.be.revertedWith("Must stake 0.05 ETH");
    });

    it("4.7 重复 claim revert", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);

      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 3000n);
      await time.increaseTo(endTime + 1);

      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await expect(
        blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE })
      ).to.be.revertedWith("Already claimed");
    });

    it("4.8 平局时更早出价者获胜", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1, bidder2 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);

      // bidder1 先出价（相同金额）
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 5000n);
      await ethers.provider.send("evm_mine", []);
      // bidder2 后出价（相同金额）
      await placeBid(blindAuction, mySecretToken, bidder2, auctionAddress, auctionId, 5000n);

      await time.increaseTo(endTime + 1);

      // bidder1 先 claim（时间戳更早）
      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(bidder2).claim(auctionId, { value: SUCCESS_FEE });

      const auction = await blindAuction.auctions(auctionId);
      expect(auction.winner).to.equal(bidder1.address);
    });

    it("4.9 claim 后 hasClaimed 标记为 true", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);

      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 3000n);
      await time.increaseTo(endTime + 1);

      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });
      expect(await blindAuction.hasClaimed(auctionId, bidder1.address)).to.be.true;
    });

    it("4.10 claim 后 stakes 记录押金金额", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);

      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 3000n);
      await time.increaseTo(endTime + 1);

      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });
      expect(await blindAuction.stakes(auctionId, bidder1.address)).to.equal(SUCCESS_FEE);
    });
  });

  // ── 5. claimNFT ──────────────────────────────────────────────────────────

  describe("5. claimNFT（NFT 转移 + 代币结算）", function () {
    /** 共用 fixture：完成出价 + claim，返回 winner（bidder1） */
    async function setupForClaimNFT() {
      const ctx = await deployAll();
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1, bidder2 } = ctx;
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);

      await time.increaseTo(startTime + 1);
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 5000n);
      await placeBid(blindAuction, mySecretToken, bidder2, auctionAddress, auctionId, 3000n);
      await time.increaseTo(endTime + 1);
      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(bidder2).claim(auctionId, { value: SUCCESS_FEE });

      return { ...ctx, auctionId };
    }

    it("5.1 winner claimNFT 后 NFT 归属到 winner", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, bidder1, auctionId } = await setupForClaimNFT();

      await blindAuction.connect(bidder1).claimNFT(auctionId);
      expect(await blindAuction.ownerOf(auctionId)).to.equal(bidder1.address);
    });

    it("5.2 claimNFT 触发 NFTClaimed 事件", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, bidder1, auctionId } = await setupForClaimNFT();
      const auction = await blindAuction.auctions(auctionId);

      await expect(blindAuction.connect(bidder1).claimNFT(auctionId))
        .to.emit(blindAuction, "NFTClaimed")
        .withArgs(auctionId, bidder1.address, auction.nftTokenId);
    });

    it("5.3 claimNFT 后 nftClaimed 标记为 true", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, bidder1, auctionId } = await setupForClaimNFT();

      await blindAuction.connect(bidder1).claimNFT(auctionId);
      const auction = await blindAuction.auctions(auctionId);
      expect(auction.nftClaimed).to.be.true;
    });

    it("5.4 非 winner 调用 claimNFT revert", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, bidder2, auctionId } = await setupForClaimNFT();

      await expect(blindAuction.connect(bidder2).claimNFT(auctionId)).to.be.revertedWith(
        "Not the winner"
      );
    });

    it("5.5 重复 claimNFT revert", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, bidder1, auctionId } = await setupForClaimNFT();

      await blindAuction.connect(bidder1).claimNFT(auctionId);
      await expect(blindAuction.connect(bidder1).claimNFT(auctionId)).to.be.revertedWith(
        "NFT already claimed"
      );
    });

    it("5.6 拍卖未结束时 claimNFT revert", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime } = await createAuction(blindAuction, seller);

      await time.increaseTo(startTime + 1);
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 5000n);

      await expect(blindAuction.connect(bidder1).claimNFT(auctionId)).to.be.reverted;
    });
  });

  // ── 6. withdrawStake（押金退还） ─────────────────────────────────────────

  describe("6. withdrawStake（押金退还）", function () {
    it("6.1 winner 完成 claim 后可退回押金", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 5000n);
      await time.increaseTo(endTime + 1);
      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });

      const before = await ethers.provider.getBalance(bidder1.address);
      await blindAuction.connect(bidder1).withdrawStake(auctionId);
      const after = await ethers.provider.getBalance(bidder1.address);

      // 退款应大于 before（扣除 gas 后仍有盈余）
      expect(after).to.be.gt(before);
    });

    it("6.2 withdrawStake 触发 StakeWithdrawn 事件", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 5000n);
      await time.increaseTo(endTime + 1);
      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });

      await expect(blindAuction.connect(bidder1).withdrawStake(auctionId))
        .to.emit(blindAuction, "StakeWithdrawn")
        .withArgs(auctionId, bidder1.address, SUCCESS_FEE);
    });

    it("6.3 未 claim 直接 withdrawStake revert", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, seller, bidder1 } = await deployAll();
      const { auctionId } = await createAuction(blindAuction, seller);

      await expect(
        blindAuction.connect(bidder1).withdrawStake(auctionId)
      ).to.be.revertedWith("Must claim first");
    });

    it("6.4 重复 withdrawStake revert（押金已清零）", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 5000n);
      await time.increaseTo(endTime + 1);
      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(bidder1).withdrawStake(auctionId);

      await expect(
        blindAuction.connect(bidder1).withdrawStake(auctionId)
      ).to.be.revertedWith("No stake to withdraw");
    });

    it("6.5 败者也可退回押金", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1, bidder2 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 5000n);
      await placeBid(blindAuction, mySecretToken, bidder2, auctionAddress, auctionId, 2000n);
      await time.increaseTo(endTime + 1);
      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(bidder2).claim(auctionId, { value: SUCCESS_FEE });

      const before = await ethers.provider.getBalance(bidder2.address);
      await blindAuction.connect(bidder2).withdrawStake(auctionId);
      const after = await ethers.provider.getBalance(bidder2.address);
      expect(after).to.be.gt(before);
    });
  });

  // ── 7. 费用管理 ──────────────────────────────────────────────────────────

  describe("7. 费用管理", function () {
    it("7.1 owner 可提取累计上架费", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, admin, seller } = await deployAll();
      await createAuction(blindAuction, seller, { metadataCID: "QmA" });
      await createAuction(blindAuction, seller, { metadataCID: "QmB" });

      const before = await ethers.provider.getBalance(admin.address);
      await blindAuction.connect(admin).withdrawFees();
      const after = await ethers.provider.getBalance(admin.address);

      expect(after).to.be.gt(before);
    });

    it("7.2 withdrawFees 触发 FeesWithdrawn 事件", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, admin, seller } = await deployAll();
      await createAuction(blindAuction, seller);

      await expect(blindAuction.connect(admin).withdrawFees())
        .to.emit(blindAuction, "FeesWithdrawn")
        .withArgs(admin.address, LISTING_FEE);
    });

    it("7.3 无费用时 withdrawFees revert", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, admin } = await deployAll();
      await expect(blindAuction.connect(admin).withdrawFees()).to.be.revertedWith("No fees to withdraw");
    });

    it("7.4 非 owner 无法提取费用", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, seller } = await deployAll();
      await expect(blindAuction.connect(seller).withdrawFees()).to.be.reverted;
    });
  });

  // ── 8. 安全与权限 ────────────────────────────────────────────────────────

  describe("8. 安全与权限", function () {
    it("8.1 owner 可暂停/恢复合约", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, admin } = await deployAll();

      await blindAuction.connect(admin).pause();
      expect(await blindAuction.paused()).to.be.true;

      await blindAuction.connect(admin).unpause();
      expect(await blindAuction.paused()).to.be.false;
    });

    it("8.2 非 owner 无法暂停", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, seller } = await deployAll();
      await expect(blindAuction.connect(seller).pause()).to.be.reverted;
    });

    it("8.3 MAX_BIDDERS_PER_AUCTION 常量为 100（DoS 防护上限）", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction } = await deployAll();
      expect(await blindAuction.MAX_BIDDERS_PER_AUCTION()).to.equal(100n);
    });
  });

  // ── 9. ERC721 合规 ────────────────────────────────────────────────────────

  describe("9. ERC721 合规", function () {
    it("9.1 支持 ERC721 接口（0x80ac58cd）", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction } = await deployAll();
      expect(await blindAuction.supportsInterface("0x80ac58cd")).to.be.true;
    });

    it("9.2 支持 ERC721Metadata 接口（0x5b5e139f）", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction } = await deployAll();
      expect(await blindAuction.supportsInterface("0x5b5e139f")).to.be.true;
    });

    it("9.3 支持 ERC721Enumerable 接口（0x780e9d63）", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction } = await deployAll();
      expect(await blindAuction.supportsInterface("0x780e9d63")).to.be.true;
    });

    it("9.4 totalSupply 随铸造增加", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, seller } = await deployAll();
      expect(await blindAuction.totalSupply()).to.equal(0n);

      await createAuction(blindAuction, seller, { metadataCID: "QmA" });
      expect(await blindAuction.totalSupply()).to.equal(1n);

      await createAuction(blindAuction, seller, { metadataCID: "QmB" });
      expect(await blindAuction.totalSupply()).to.equal(2n);
    });

    it("9.5 合约 balanceOf 随 NFT 铸造增加", async function () {
      if (!fhevm.isMock) this.skip();
      const { blindAuction, auctionAddress, seller } = await deployAll();
      await createAuction(blindAuction, seller);

      expect(await blindAuction.balanceOf(auctionAddress)).to.equal(1n);
    });

    it("9.6 claimNFT 后合约 balanceOf 减少，winner balanceOf 增加", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(60_000);
      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);
      await time.increaseTo(startTime + 1);
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 5000n);
      await time.increaseTo(endTime + 1);
      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(bidder1).claimNFT(auctionId);

      expect(await blindAuction.balanceOf(auctionAddress)).to.equal(0n);
      expect(await blindAuction.balanceOf(bidder1.address)).to.equal(1n);
    });
  });

  // ── 10. TokenExchange ────────────────────────────────────────────────────

  describe("10. TokenExchange", function () {
    it("10.1 buyTokens 正确铸造代币", async function () {
      if (!fhevm.isMock) this.skip();
      const { tokenExchange, bidder1 } = await deployAll();

      await expect(
        tokenExchange.connect(bidder1).buyTokens({ value: ethers.parseEther("0.001") })
      )
        .to.emit(tokenExchange, "TokensPurchased")
        .withArgs(bidder1.address, ethers.parseEther("0.001"), 1000n);
    });

    it("10.2 calculateTokenAmount 正确计算", async function () {
      if (!fhevm.isMock) this.skip();
      const { tokenExchange } = await deployAll();
      const amount = await tokenExchange.calculateTokenAmount(ethers.parseEther("1"));
      expect(amount).to.equal(1_000_000n);
    });

    it("10.3 calculateEthAmount 正确计算", async function () {
      if (!fhevm.isMock) this.skip();
      const { tokenExchange } = await deployAll();
      const eth = await tokenExchange.calculateEthAmount(1_000_000n);
      expect(eth).to.equal(ethers.parseEther("1"));
    });

    it("10.4 不发送 ETH 调用 buyTokens revert", async function () {
      if (!fhevm.isMock) this.skip();
      const { tokenExchange, bidder1 } = await deployAll();
      await expect(
        tokenExchange.connect(bidder1).buyTokens({ value: 0n })
      ).to.be.revertedWith("Must send ETH");
    });
  });

  // ── 11. 完整端到端流程 ───────────────────────────────────────────────────

  describe("11. 完整端到端流程", function () {
    it("11.1 标准流程：创建 → 出价 → claim → claimNFT → withdrawStake", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(120_000);

      const { blindAuction, mySecretToken, auctionAddress, admin, seller, bidder1, bidder2 } = await deployAll();

      // 1. 创建拍卖
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller, {
        metadataCID: "QmE2E",
        minimumBid: 500n,
      });
      expect(await blindAuction.ownerOf(auctionId)).to.equal(auctionAddress); // NFT 在合约

      // 2. 出价
      await time.increaseTo(startTime + 1);
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 8000n);
      await placeBid(blindAuction, mySecretToken, bidder2, auctionAddress, auctionId, 5000n);

      // 3. 等待结束并 claim
      await time.increaseTo(endTime + 1);
      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(bidder2).claim(auctionId, { value: SUCCESS_FEE });

      const auction = await blindAuction.auctions(auctionId);
      expect(auction.winner).to.equal(bidder1.address); // 出价最高者获胜

      // 4. winner claimNFT（同时结算代币）
      await blindAuction.connect(bidder1).claimNFT(auctionId);
      expect(await blindAuction.ownerOf(auctionId)).to.equal(bidder1.address);

      const finalAuction = await blindAuction.auctions(auctionId);
      expect(finalAuction.nftClaimed).to.be.true;

      // 5. 所有人退押金
      await blindAuction.connect(bidder1).withdrawStake(auctionId);
      await blindAuction.connect(bidder2).withdrawStake(auctionId);

      expect(await blindAuction.stakes(auctionId, bidder1.address)).to.equal(0n);
      expect(await blindAuction.stakes(auctionId, bidder2.address)).to.equal(0n);

      // 6. owner 提取手续费
      const feesBefore = await ethers.provider.getBalance(admin.address);
      await blindAuction.connect(admin).withdrawFees();
      const feesAfter = await ethers.provider.getBalance(admin.address);
      expect(feesAfter).to.be.gt(feesBefore);
    });

    it("11.2 三人竞价，最高价胜者正确", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(120_000);

      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1, bidder2, bidder3 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);

      await time.increaseTo(startTime + 1);
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 1000n);
      await placeBid(blindAuction, mySecretToken, bidder2, auctionAddress, auctionId, 9999n);
      await placeBid(blindAuction, mySecretToken, bidder3, auctionAddress, auctionId, 5555n);

      await time.increaseTo(endTime + 1);
      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(bidder2).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(bidder3).claim(auctionId, { value: SUCCESS_FEE });

      const auction = await blindAuction.auctions(auctionId);
      expect(auction.winner).to.equal(bidder2.address);
    });

    it("11.3 追加出价后以累计金额竞争", async function () {
      if (!fhevm.isMock) this.skip();
      this.timeout(120_000);

      const { blindAuction, mySecretToken, auctionAddress, seller, bidder1, bidder2 } = await deployAll();
      const { auctionId, startTime, endTime } = await createAuction(blindAuction, seller);

      await time.increaseTo(startTime + 1);
      // bidder1 分三次累计出价 = 3000
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 1000n);
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 1000n);
      await placeBid(blindAuction, mySecretToken, bidder1, auctionAddress, auctionId, 1000n);

      // bidder2 一次出价 = 2500（少于 bidder1 累计）
      await placeBid(blindAuction, mySecretToken, bidder2, auctionAddress, auctionId, 2500n);

      await time.increaseTo(endTime + 1);
      await blindAuction.connect(bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(bidder2).claim(auctionId, { value: SUCCESS_FEE });

      const auction = await blindAuction.auctions(auctionId);
      expect(auction.winner).to.equal(bidder1.address);
    });
  });
});
