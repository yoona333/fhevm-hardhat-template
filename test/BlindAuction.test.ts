/**
 * BlindAuction 测试套件
 *
 * 合约流程：
 *   createAuction → bid → requestWinnerDecryption → (链下公开解密) → submitWinner
 *   → withdraw（非winner）/ claimNFT（winner）
 *
 * 测试说明：
 *   - 使用 fhevm.createEncryptedInput 加密出价
 *   - 使用 fhevm.publicDecryptEaddress 解密加密的 winner 地址（需先调用 requestWinnerDecryption）
 *   - 测试环境为 FHEVM mock 模式（本地 hardhat 网络）
 */

import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { BlindAuction, MySecretToken, TokenExchange } from "../types";

// ─── 常量 ────────────────────────────────────────────────────────────────────

const LISTING_FEE     = ethers.parseEther("0.01");
const BID_FEE_PERCENT = 2n;

// ─── 工具函数 ────────────────────────────────────────────────────────────────

async function deployAll() {
  const [admin, seller, bidder1, bidder2, bidder3] = await ethers.getSigners();

  const TokenFactory = await ethers.getContractFactory("MySecretToken");
  const token = (await TokenFactory.deploy(
    "Secret Auction Token",
    "SAT",
    "ipfs://meta",
  )) as MySecretToken;
  const tokenAddress = await token.getAddress();

  const ExchangeFactory = await ethers.getContractFactory("TokenExchange");
  const exchange = (await ExchangeFactory.deploy(tokenAddress)) as TokenExchange;
  const exchangeAddress = await exchange.getAddress();

  const AuctionFactory = await ethers.getContractFactory("BlindAuction");
  const auction = (await AuctionFactory.deploy(
    tokenAddress,
    "BlindAuction NFT",
    "BAFT",
    BID_FEE_PERCENT,
  )) as BlindAuction;
  const auctionAddress = await auction.getAddress();

  // TokenExchange 成为 token owner（负责铸造）
  await token.connect(admin).transferOwnership(exchangeAddress);

  // 给出价者铸造代币 & 授权 BlindAuction 合约
  const farFuture = Math.floor(Date.now() / 1000) + 86400 * 365 * 10;
  for (const bidder of [bidder1, bidder2, bidder3]) {
    await exchange.connect(bidder).buyTokens({ value: ethers.parseEther("100") });
    await token.connect(bidder).setOperator(auctionAddress, farFuture);
  }

  return { auction, token, exchange, admin, seller, bidder1, bidder2, bidder3, auctionAddress, tokenAddress };
}

/** 创建拍卖并推进时间到拍卖开始 */
async function createAuction(
  auction: BlindAuction,
  seller: HardhatEthersSigner,
  opts: { duration?: number; minimumBid?: bigint } = {},
) {
  const now       = await time.latest();
  const startTime = now + 2;
  const endTime   = now + (opts.duration ?? 3600);

  const tx = await auction.connect(seller).createAuction(
    "QmTestCID",
    startTime,
    endTime,
    opts.minimumBid ?? 100n,
    { value: LISTING_FEE },
  );
  const receipt = await tx.wait();
  const event = receipt!.logs
    .map((l) => { try { return auction.interface.parseLog(l); } catch { return null; } })
    .find((e) => e?.name === "AuctionCreated");
  const auctionId = event!.args.auctionId as bigint;

  await time.increase(3);

  return { auctionId, startTime, endTime };
}

/** 加密出价并提交 */
async function placeBid(
  auction: BlindAuction,
  bidder: HardhatEthersSigner,
  auctionId: bigint,
  amount: bigint,
) {
  const auctionAddress = await auction.getAddress();
  const enc = await fhevm
    .createEncryptedInput(auctionAddress, bidder.address)
    .add64(amount)
    .encrypt();
  return auction.connect(bidder).bid(auctionId, enc.handles[0], enc.inputProof);
}

/**
 * 完整的 winner 解析流程：
 *   1. requestWinnerDecryption —— 标记 encryptedWinner 为可公开解密
 *   2. fhevm.publicDecryptEaddress —— 链下解密获取明文地址
 *   3. submitWinner —— 将明文地址写入合约
 */
async function resolveWinner(
  auction: BlindAuction,
  caller: HardhatEthersSigner,
  auctionId: bigint,
) {
  const auctionAddress = await auction.getAddress();

  // Step 1: 触发公开解密标记
  await auction.connect(caller).requestWinnerDecryption(auctionId);

  // Step 2: 读取加密 winner 句柄，链下解密
  const encHandle = await auction.getEncryptedWinner(auctionId);
  const winnerAddress = await fhevm.publicDecryptEaddress(encHandle as string);

  // Step 3: 提交明文 winner 地址
  await auction.connect(caller).submitWinner(auctionId, winnerAddress);

  return winnerAddress;
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe("BlindAuction", function () {

  // ── 1. 部署与基础配置 ──────────────────────────────────────────────────────

  describe("1. 部署与基础配置", function () {

    it("1.1 成功部署，owner 正确", async function () {
      const { auction, admin } = await deployAll();
      expect(await auction.owner()).to.equal(admin.address);
    });

    it("1.2 bidFeePercent 正确", async function () {
      const { auction } = await deployAll();
      expect(await auction.bidFeePercent()).to.equal(BID_FEE_PERCENT);
    });

    it("1.3 LISTING_FEE 正确", async function () {
      const { auction } = await deployAll();
      expect(await auction.LISTING_FEE()).to.equal(LISTING_FEE);
    });

    it("1.4 初始 nextAuctionId 为 0", async function () {
      const { auction } = await deployAll();
      expect(await auction.nextAuctionId()).to.equal(0n);
    });

    it("1.5 bidFeePercent 超过 100 时部署失败", async function () {
      const { tokenAddress } = await deployAll();
      const AuctionFactory = await ethers.getContractFactory("BlindAuction");
      await expect(
        AuctionFactory.deploy(tokenAddress, "Test", "TST", 101n),
      ).to.be.revertedWith("Fee percent must be <= 100");
    });

  });

  // ── 2. 创建拍卖 ────────────────────────────────────────────────────────────

  describe("2. 创建拍卖", function () {

    it("2.1 成功创建拍卖，铸造 NFT", async function () {
      const { auction, seller } = await deployAll();
      const { auctionId } = await createAuction(auction, seller);

      expect(auctionId).to.equal(0n);
      expect(await auction.nextAuctionId()).to.equal(1n);

      const [beneficiary, , , , , , minBid] = await auction.getAuction(auctionId);
      expect(beneficiary).to.equal(seller.address);
      expect(minBid).to.equal(100n);
    });

    it("2.2 NFT 持有者为合约", async function () {
      const { auction, seller, auctionAddress } = await deployAll();
      const { auctionId } = await createAuction(auction, seller);
      const [, , tokenId] = await auction.getAuction(auctionId);
      expect(await auction.ownerOf(tokenId)).to.equal(auctionAddress);
    });

    it("2.3 上架费不足时失败", async function () {
      const { auction, seller } = await deployAll();
      const now = await time.latest();
      await expect(
        auction.connect(seller).createAuction("QmCID", now + 2, now + 3600, 100n, {
          value: ethers.parseEther("0.001"),
        }),
      ).to.be.revertedWith("Insufficient listing fee");
    });

    it("2.4 开始时间晚于结束时间时失败", async function () {
      const { auction, seller } = await deployAll();
      const now = await time.latest();
      await expect(
        auction.connect(seller).createAuction("QmCID", now + 3600, now + 1, 100n, {
          value: LISTING_FEE,
        }),
      ).to.be.revertedWith("Invalid time range");
    });

    it("2.5 上架费直接转给 owner", async function () {
      const { auction, seller, admin } = await deployAll();
      const before = await ethers.provider.getBalance(admin.address);
      await createAuction(auction, seller);
      const after = await ethers.provider.getBalance(admin.address);
      expect(after - before).to.equal(LISTING_FEE);
    });

    it("2.6 metadataCID 为空时失败", async function () {
      const { auction, seller } = await deployAll();
      const now = await time.latest();
      await expect(
        auction.connect(seller).createAuction("", now + 2, now + 3600, 100n, {
          value: LISTING_FEE,
        }),
      ).to.be.revertedWith("Metadata CID required");
    });

    it("2.7 minimumBid 为 0 时失败", async function () {
      const { auction, seller } = await deployAll();
      const now = await time.latest();
      await expect(
        auction.connect(seller).createAuction("QmCID", now + 2, now + 3600, 0n, {
          value: LISTING_FEE,
        }),
      ).to.be.revertedWith("Minimum bid must be > 0");
    });

  });

  // ── 3. 出价（FHEVM 加密）──────────────────────────────────────────────────

  describe("3. 出价（FHEVM 加密）", function () {

    it("3.1 出价成功，发出 BidPlaced 事件", async function () {
      const { auction, token, seller, bidder1 } = await deployAll();
      const { auctionId } = await createAuction(auction, seller);

      await expect(placeBid(auction, bidder1, auctionId, 1000n))
        .to.emit(auction, "BidPlaced")
        .withArgs(auctionId, bidder1.address);
    });

    it("3.2 出价后记录加密竞拍金", async function () {
      const { auction, seller, bidder1 } = await deployAll();
      const { auctionId } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      const encBid = await auction.getEncryptedBid(auctionId, bidder1.address);
      expect(encBid).to.not.equal(ethers.ZeroHash);
    });

    it("3.3 出价后记录加密 winner 句柄", async function () {
      const { auction, seller, bidder1 } = await deployAll();
      const { auctionId } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      const encWinner = await auction.getEncryptedWinner(auctionId);
      expect(encWinner).to.not.equal(ethers.ZeroHash);
    });

    it("3.4 拍卖结束后出价失败", async function () {
      const { auction, seller, bidder1 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);
      await time.increaseTo(endTime + 1);

      const auctionAddress = await auction.getAddress();
      const enc = await fhevm
        .createEncryptedInput(auctionAddress, bidder1.address)
        .add64(1000n)
        .encrypt();

      let threw = false;
      try {
        await auction.connect(bidder1).bid(auctionId, enc.handles[0], enc.inputProof);
      } catch {
        threw = true;
      }
      expect(threw).to.be.true;
    });

    it("3.5 同一出价者追加出价记录累加", async function () {
      const { auction, seller, bidder1 } = await deployAll();
      const { auctionId } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 500n);
      await placeBid(auction, bidder1, auctionId, 500n);
      // 竞拍者计数仍为 1（同一地址不重复记录）
      expect(await auction.getBiddersCount(auctionId)).to.equal(1n);
    });

    it("3.6 多个出价者各自记录", async function () {
      const { auction, seller, bidder1, bidder2, bidder3 } = await deployAll();
      const { auctionId } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      await placeBid(auction, bidder2, auctionId, 2000n);
      await placeBid(auction, bidder3, auctionId, 3000n);
      expect(await auction.getBiddersCount(auctionId)).to.equal(3n);
    });

  });

  // ── 4. requestWinnerDecryption & submitWinner ──────────────────────────────

  describe("4. 解析 winner", function () {

    it("4.1 拍卖结束后成功解析 winner", async function () {
      const { auction, seller, bidder1 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      await time.increaseTo(endTime + 1);

      const winner = await resolveWinner(auction, bidder1, auctionId);
      expect(winner.toLowerCase()).to.equal(bidder1.address.toLowerCase());
      expect((await auction.auctionWinner(auctionId)).toLowerCase())
        .to.equal(bidder1.address.toLowerCase());
    });

    it("4.2 出价更高者成为 winner", async function () {
      const { auction, seller, bidder1, bidder2 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);

      await placeBid(auction, bidder1, auctionId, 1000n);
      await placeBid(auction, bidder2, auctionId, 2000n);
      await time.increaseTo(endTime + 1);

      const winner = await resolveWinner(auction, bidder1, auctionId);
      expect(winner.toLowerCase()).to.equal(bidder2.address.toLowerCase());
    });

    it("4.3 出价相同时先出价者保持 winner", async function () {
      const { auction, seller, bidder1, bidder2 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);

      await placeBid(auction, bidder1, auctionId, 1000n);
      await placeBid(auction, bidder2, auctionId, 1000n);
      await time.increaseTo(endTime + 1);

      // bidder1 先出价，相同金额不替换，winner 应为 bidder1
      const winner = await resolveWinner(auction, bidder1, auctionId);
      expect(winner.toLowerCase()).to.equal(bidder1.address.toLowerCase());
    });

    it("4.4 拍卖期间调用 requestWinnerDecryption 失败", async function () {
      const { auction, seller, bidder1 } = await deployAll();
      const { auctionId } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);

      await expect(
        auction.connect(bidder1).requestWinnerDecryption(auctionId),
      ).to.be.reverted;
    });

    it("4.5 重复 submitWinner 失败", async function () {
      const { auction, seller, bidder1 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      await time.increaseTo(endTime + 1);

      await resolveWinner(auction, bidder1, auctionId);

      await expect(
        auction.connect(bidder1).submitWinner(auctionId, bidder1.address),
      ).to.be.revertedWith("Already resolved");
    });

    it("4.6 winner 地址没有出价记录时 submitWinner 失败", async function () {
      const { auction, seller, bidder1, bidder2 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      await time.increaseTo(endTime + 1);
      await auction.connect(bidder1).requestWinnerDecryption(auctionId);

      await expect(
        auction.connect(bidder1).submitWinner(auctionId, bidder2.address),
      ).to.be.revertedWith("Winner has no bid");
    });

    it("4.7 无出价时 requestWinnerDecryption 失败", async function () {
      const { auction, seller, bidder1 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);
      await time.increaseTo(endTime + 1);

      await expect(
        auction.connect(bidder1).requestWinnerDecryption(auctionId),
      ).to.be.revertedWith("No bids placed");
    });

  });

  // ── 5. withdraw（非 winner 取回竞拍金）────────────────────────────────────

  describe("5. withdraw（非 winner 取回竞拍金）", function () {

    it("5.1 非 winner 成功取回竞拍金", async function () {
      const { auction, seller, bidder1, bidder2 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);

      await placeBid(auction, bidder1, auctionId, 1000n);
      await placeBid(auction, bidder2, auctionId, 2000n);
      await time.increaseTo(endTime + 1);
      await resolveWinner(auction, bidder1, auctionId);

      await expect(auction.connect(bidder1).withdraw(auctionId))
        .to.emit(auction, "BidWithdrawn")
        .withArgs(auctionId, bidder1.address);

      expect(await auction.hasWithdrawn(auctionId, bidder1.address)).to.be.true;
    });

    it("5.2 winner 无法调用 withdraw", async function () {
      const { auction, seller, bidder1 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      await time.increaseTo(endTime + 1);
      await resolveWinner(auction, bidder1, auctionId);

      await expect(
        auction.connect(bidder1).withdraw(auctionId),
      ).to.be.revertedWith("Winner cannot withdraw, use claimNFT");
    });

    it("5.3 winner 未确认前无法 withdraw", async function () {
      const { auction, seller, bidder1, bidder2 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      await placeBid(auction, bidder2, auctionId, 2000n);
      await time.increaseTo(endTime + 1);

      await expect(
        auction.connect(bidder1).withdraw(auctionId),
      ).to.be.revertedWith("Winner not resolved yet");
    });

    it("5.4 重复 withdraw 失败", async function () {
      const { auction, seller, bidder1, bidder2 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      await placeBid(auction, bidder2, auctionId, 2000n);
      await time.increaseTo(endTime + 1);
      await resolveWinner(auction, bidder1, auctionId);
      await auction.connect(bidder1).withdraw(auctionId);

      await expect(
        auction.connect(bidder1).withdraw(auctionId),
      ).to.be.revertedWith("Already withdrawn");
    });

    it("5.5 没有出价记录时 withdraw 失败", async function () {
      const { auction, seller, bidder1, bidder2, bidder3 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      await placeBid(auction, bidder2, auctionId, 2000n);
      await time.increaseTo(endTime + 1);
      await resolveWinner(auction, bidder2, auctionId);

      await expect(
        auction.connect(bidder3).withdraw(auctionId),
      ).to.be.revertedWith("No bid found");
    });

    it("5.6 拍卖结束前无法 withdraw", async function () {
      const { auction, seller, bidder1, bidder2 } = await deployAll();
      const { auctionId } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      await placeBid(auction, bidder2, auctionId, 2000n);

      await expect(
        auction.connect(bidder1).withdraw(auctionId),
      ).to.be.reverted;
    });

  });

  // ── 6. claimNFT（winner 领取 NFT）─────────────────────────────────────────

  describe("6. claimNFT（winner 领取 NFT）", function () {

    it("6.1 winner 成功领取 NFT", async function () {
      const { auction, seller, bidder1 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      await time.increaseTo(endTime + 1);
      await resolveWinner(auction, bidder1, auctionId);

      const [, , tokenId] = await auction.getAuction(auctionId);
      await expect(auction.connect(bidder1).claimNFT(auctionId))
        .to.emit(auction, "NFTClaimed")
        .withArgs(auctionId, bidder1.address, tokenId);

      expect(await auction.ownerOf(tokenId)).to.equal(bidder1.address);
    });

    it("6.2 claimNFT 后 nftClaimed 为 true", async function () {
      const { auction, seller, bidder1 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      await time.increaseTo(endTime + 1);
      await resolveWinner(auction, bidder1, auctionId);
      await auction.connect(bidder1).claimNFT(auctionId);

      const [, , , nftClaimed] = await auction.getAuction(auctionId);
      expect(nftClaimed).to.be.true;
    });

    it("6.3 非 winner 无法 claimNFT", async function () {
      const { auction, seller, bidder1, bidder2 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      await placeBid(auction, bidder2, auctionId, 2000n);
      await time.increaseTo(endTime + 1);
      await resolveWinner(auction, bidder1, auctionId);

      await expect(
        auction.connect(bidder1).claimNFT(auctionId),
      ).to.be.revertedWith("Not the winner");
    });

    it("6.4 重复 claimNFT 失败", async function () {
      const { auction, seller, bidder1 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      await time.increaseTo(endTime + 1);
      await resolveWinner(auction, bidder1, auctionId);
      await auction.connect(bidder1).claimNFT(auctionId);

      await expect(
        auction.connect(bidder1).claimNFT(auctionId),
      ).to.be.revertedWith("NFT already claimed");
    });

    it("6.5 winner 未确认前无法 claimNFT", async function () {
      const { auction, seller, bidder1 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);
      await placeBid(auction, bidder1, auctionId, 1000n);
      await time.increaseTo(endTime + 1);

      await expect(
        auction.connect(bidder1).claimNFT(auctionId),
      ).to.be.revertedWith("Winner not resolved yet");
    });

  });

  // ── 7. 安全与边界 ──────────────────────────────────────────────────────────

  describe("7. 安全与边界", function () {

    it("7.1 暂停后无法创建拍卖", async function () {
      const { auction, admin, seller } = await deployAll();
      await auction.connect(admin).pause();
      expect(await auction.paused()).to.be.true;

      const now = await time.latest();
      let threw = false;
      try {
        await auction.connect(seller).createAuction("QmCID", now + 2, now + 3600, 100n, {
          value: LISTING_FEE,
        });
      } catch { threw = true; }
      expect(threw).to.be.true;
    });

    it("7.2 暂停后无法出价", async function () {
      const { auction, admin, seller, bidder1 } = await deployAll();
      const { auctionId } = await createAuction(auction, seller);
      await auction.connect(admin).pause();

      const auctionAddress = await auction.getAddress();
      const enc = await fhevm
        .createEncryptedInput(auctionAddress, bidder1.address)
        .add64(1000n)
        .encrypt();

      let threw = false;
      try {
        await auction.connect(bidder1).bid(auctionId, enc.handles[0], enc.inputProof);
      } catch { threw = true; }
      expect(threw).to.be.true;
    });

    it("7.3 恢复后正常运作", async function () {
      const { auction, admin, seller } = await deployAll();
      await auction.connect(admin).pause();
      await auction.connect(admin).unpause();
      expect(await auction.paused()).to.be.false;

      const now = await time.latest();
      await expect(
        auction.connect(seller).createAuction("QmCID", now + 2, now + 3600, 100n, {
          value: LISTING_FEE,
        }),
      ).to.not.be.reverted;
    });

    it("7.4 非 owner 无法暂停", async function () {
      const { auction, seller } = await deployAll();
      await expect(auction.connect(seller).pause()).to.be.reverted;
    });

    it("7.5 不存在的 auctionId 操作失败", async function () {
      const { auction, bidder1 } = await deployAll();
      await expect(auction.connect(bidder1).withdraw(999n)).to.be.reverted;
    });

    it("7.6 MAX_BIDDERS_PER_AUCTION 为 100", async function () {
      const { auction } = await deployAll();
      expect(await auction.MAX_BIDDERS_PER_AUCTION()).to.equal(100n);
    });

  });

  // ── 8. 端到端完整流程 ──────────────────────────────────────────────────────

  describe("8. 端到端完整流程", function () {

    it("8.1 单人竞拍完整流程", async function () {
      const { auction, seller, bidder1 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);

      await placeBid(auction, bidder1, auctionId, 1000n);
      await time.increaseTo(endTime + 1);

      const winner = await resolveWinner(auction, bidder1, auctionId);
      expect(winner.toLowerCase()).to.equal(bidder1.address.toLowerCase());

      const [, , tokenId] = await auction.getAuction(auctionId);
      await auction.connect(bidder1).claimNFT(auctionId);
      expect(await auction.ownerOf(tokenId)).to.equal(bidder1.address);
    });

    it("8.2 三人竞拍，最高价者获胜，其余取回竞拍金", async function () {
      const { auction, seller, bidder1, bidder2, bidder3 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);

      await placeBid(auction, bidder1, auctionId, 1000n);
      await placeBid(auction, bidder2, auctionId, 3000n); // 最高
      await placeBid(auction, bidder3, auctionId, 2000n);
      await time.increaseTo(endTime + 1);

      const winner = await resolveWinner(auction, bidder1, auctionId);
      expect(winner.toLowerCase()).to.equal(bidder2.address.toLowerCase());

      // winner 领取 NFT
      const [, , tokenId] = await auction.getAuction(auctionId);
      await auction.connect(bidder2).claimNFT(auctionId);
      expect(await auction.ownerOf(tokenId)).to.equal(bidder2.address);

      // 非 winner 取回竞拍金
      await auction.connect(bidder1).withdraw(auctionId);
      await auction.connect(bidder3).withdraw(auctionId);
      expect(await auction.hasWithdrawn(auctionId, bidder1.address)).to.be.true;
      expect(await auction.hasWithdrawn(auctionId, bidder3.address)).to.be.true;
    });

    it("8.3 多个拍卖互不干扰", async function () {
      const { auction, seller, bidder1, bidder2 } = await deployAll();

      const r0 = await createAuction(auction, seller, { duration: 3600 });
      const r1 = await createAuction(auction, seller, { duration: 7200 });

      await placeBid(auction, bidder1, r0.auctionId, 1000n);
      await placeBid(auction, bidder2, r1.auctionId, 2000n);

      await time.increaseTo(r0.endTime + 1);
      await resolveWinner(auction, bidder1, r0.auctionId);

      // auction0 winner 为 bidder1，auction1 未解析
      expect((await auction.auctionWinner(r0.auctionId)).toLowerCase())
        .to.equal(bidder1.address.toLowerCase());
      expect(await auction.auctionWinner(r1.auctionId)).to.equal(ethers.ZeroAddress);
    });

    it("8.4 bidder 追加出价后累计超过对手成为 winner", async function () {
      const { auction, seller, bidder1, bidder2 } = await deployAll();
      const { auctionId, endTime } = await createAuction(auction, seller);

      await placeBid(auction, bidder1, auctionId, 1000n);
      await placeBid(auction, bidder2, auctionId, 2000n); // bidder2 暂时领先
      await placeBid(auction, bidder1, auctionId, 2000n); // bidder1 累计 3000，超过 bidder2

      await time.increaseTo(endTime + 1);
      const winner = await resolveWinner(auction, bidder1, auctionId);
      expect(winner.toLowerCase()).to.equal(bidder1.address.toLowerCase());
    });

    it("8.5 卖家创建多场拍卖，每场独立计费", async function () {
      const { auction, admin, seller } = await deployAll();
      const before = await ethers.provider.getBalance(admin.address);

      await createAuction(auction, seller);
      await createAuction(auction, seller);

      const after = await ethers.provider.getBalance(admin.address);
      expect(after - before).to.equal(LISTING_FEE * 2n);
    });

  });

});
