import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { BlindAuction, BlindAuction__factory, MySecretToken, MySecretToken__factory, TokenExchange, TokenExchange__factory } from "../types";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  charlie: HardhatEthersSigner;
  dave: HardhatEthersSigner;
};

async function deployFixture() {
  const tokenFactory = (await ethers.getContractFactory("MySecretToken")) as MySecretToken__factory;
  const token = (await tokenFactory.deploy(
    "Secret Auction Token",
    "SAT",
    "ipfs://test-metadata"
  )) as MySecretToken;
  const tokenAddress = await token.getAddress();

  const exchangeFactory = (await ethers.getContractFactory("TokenExchange")) as TokenExchange__factory;
  const exchange = (await exchangeFactory.deploy(tokenAddress)) as TokenExchange;
  const exchangeAddress = await exchange.getAddress();

  await token.transferOwnership(exchangeAddress);

  const auctionFactory = (await ethers.getContractFactory("BlindAuction")) as BlindAuction__factory;
  const auction = (await auctionFactory.deploy(tokenAddress)) as BlindAuction;
  const auctionAddress = await auction.getAddress();

  return { token, tokenAddress, exchange, exchangeAddress, auction, auctionAddress };
}

describe("BlindAuction", function () {
  let signers: Signers;
  let token: MySecretToken;
  let tokenAddress: string;
  let exchange: TokenExchange;
  let exchangeAddress: string;
  let auction: BlindAuction;
  let auctionAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = {
      deployer: ethSigners[0],
      alice: ethSigners[1],
      bob: ethSigners[2],
      charlie: ethSigners[3],
      dave: ethSigners[4],
    };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite can only run on FHEVM mock environment");
      this.skip();
    }

    ({ token, tokenAddress, exchange, exchangeAddress, auction, auctionAddress } = await deployFixture());

    // Give all users tokens for bidding
    const oneYear = Math.floor(Date.now() / 1000) + 365 * 86400;

    await exchange.connect(signers.bob).buyTokens({ value: ethers.parseEther("1") });
    await token.connect(signers.bob).setOperator(auctionAddress, oneYear);

    await exchange.connect(signers.charlie).buyTokens({ value: ethers.parseEther("1") });
    await token.connect(signers.charlie).setOperator(auctionAddress, oneYear);

    await exchange.connect(signers.dave).buyTokens({ value: ethers.parseEther("1") });
    await token.connect(signers.dave).setOperator(auctionAddress, oneYear);

    // Alice (seller) also gets tokens for verification
    await exchange.connect(signers.alice).buyTokens({ value: ethers.parseEther("1") });
  });

  describe("Deployment", function () {
    it("should set the correct owner", async function () {
      expect(await auction.owner()).to.equal(signers.deployer.address);
    });

    it("should set the correct token address", async function () {
      expect(await auction.confidentialToken()).to.equal(tokenAddress);
    });

    it("should have zero auctions initially", async function () {
      expect(await auction.nextAuctionId()).to.equal(0);
    });

    it("should have correct listing fee", async function () {
      expect(await auction.LISTING_FEE()).to.equal(ethers.parseEther("0.01"));
    });

    it("should have correct success fee", async function () {
      expect(await auction.SUCCESS_FEE()).to.equal(ethers.parseEther("0.05"));
    });
  });

  describe("Creating Auctions", function () {
    it("should create auction successfully", async function () {
      const now = await time.latest();
      const startTime = now + 100;
      const endTime = startTime + 3600;

      const tx = await auction.connect(signers.alice).createAuction("QmTest123", startTime, endTime, {
        value: ethers.parseEther("0.01"),
      });

      const receipt = await tx.wait();
      expect(receipt).to.not.be.undefined;

      expect(await auction.nextAuctionId()).to.equal(1);

      const auctionData = await auction.getAuction(0);
      expect(auctionData.beneficiaryAddr).to.equal(signers.alice.address);
      expect(auctionData.metadataCID).to.equal("QmTest123");
      expect(auctionData.startTime).to.equal(startTime);
      expect(auctionData.endTime).to.equal(endTime);
    });

    it("should emit AuctionCreated event", async function () {
      const now = await time.latest();
      const startTime = now + 100;
      const endTime = startTime + 3600;

      await expect(
        auction.connect(signers.alice).createAuction("QmEventTest", startTime, endTime, {
          value: ethers.parseEther("0.01"),
        })
      )
        .to.emit(auction, "AuctionCreated")
        .withArgs(0, signers.alice.address, "QmEventTest", startTime, endTime);
    });

    it("should revert if insufficient listing fee", async function () {
      const now = await time.latest();

      await expect(
        auction.connect(signers.alice).createAuction("QmTest", now + 100, now + 3700, {
          value: ethers.parseEther("0.001"),
        })
      ).to.be.revertedWith("Insufficient listing fee");
    });

    it("should revert if end time before start time", async function () {
      const now = await time.latest();

      await expect(
        auction.connect(signers.alice).createAuction("QmTest", now + 3600, now + 100, {
          value: ethers.parseEther("0.01"),
        })
      ).to.be.revertedWith("Invalid time");
    });

    it("should revert if start time in the past", async function () {
      await expect(
        auction.connect(signers.alice).createAuction("QmTest", 100, 200, {
          value: ethers.parseEther("0.01"),
        })
      ).to.be.revertedWith("Start time cannot be in the past");
    });

    it("should revert if metadata CID is empty", async function () {
      const now = await time.latest();

      await expect(
        auction.connect(signers.alice).createAuction("", now + 100, now + 3700, {
          value: ethers.parseEther("0.01"),
        })
      ).to.be.revertedWith("Metadata CID required");
    });

    it("should track user created auctions", async function () {
      const now = await time.latest();

      await auction.connect(signers.alice).createAuction("QmTest1", now + 100, now + 3700, {
        value: ethers.parseEther("0.01"),
      });

      await auction.connect(signers.alice).createAuction("QmTest2", now + 100, now + 3700, {
        value: ethers.parseEther("0.01"),
      });

      const aliceAuctions = await auction.getUserCreatedAuctions(signers.alice.address);
      expect(aliceAuctions.length).to.equal(2);
      expect(aliceAuctions[0]).to.equal(0);
      expect(aliceAuctions[1]).to.equal(1);
    });
  });

  describe("Bidding", function () {
    let auctionId: number;

    beforeEach(async function () {
      const now = await time.latest();
      const startTime = now + 100;
      const endTime = startTime + 3600;

      await auction.connect(signers.alice).createAuction("QmBidTest", startTime, endTime, {
        value: ethers.parseEther("0.01"),
      });

      auctionId = 0;
      await time.increaseTo(startTime);
    });

    it("should allow placing bids", async function () {
      const encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.bob.address)
        .add64(100000n)
        .encrypt();

      const tx = await auction
        .connect(signers.bob)
        .bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      await expect(tx).to.emit(auction, "BidPlaced").withArgs(auctionId, signers.bob.address);
    });

    it("should allow multiple bids from different users", async function () {
      let encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.bob.address)
        .add64(100000n)
        .encrypt();
      await auction.connect(signers.bob).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.charlie.address)
        .add64(200000n)
        .encrypt();
      await auction.connect(signers.charlie).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.dave.address)
        .add64(150000n)
        .encrypt();
      await auction.connect(signers.dave).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      const bobBids = await auction.getUserBidAuctions(signers.bob.address);
      const charlieBids = await auction.getUserBidAuctions(signers.charlie.address);
      const daveBids = await auction.getUserBidAuctions(signers.dave.address);

      expect(bobBids.length).to.equal(1);
      expect(charlieBids.length).to.equal(1);
      expect(daveBids.length).to.equal(1);
    });

    it("should allow users to increase their bid", async function () {
      let encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.bob.address)
        .add64(100000n)
        .encrypt();
      await auction.connect(signers.bob).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.bob.address)
        .add64(50000n)
        .encrypt();
      await auction.connect(signers.bob).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      const bobBids = await auction.getUserBidAuctions(signers.bob.address);
      expect(bobBids.length).to.equal(1); // Still only 1 auction entry
    });

    it("should revert if auction hasn't started", async function () {
      const now = await time.latest();
      const futureStart = now + 10000;
      const futureEnd = futureStart + 3600;

      await auction.connect(signers.alice).createAuction("QmFuture", futureStart, futureEnd, {
        value: ethers.parseEther("0.01"),
      });

      const newAuctionId = 1;

      const encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.bob.address)
        .add64(100000n)
        .encrypt();

      await expect(
        auction
          .connect(signers.bob)
          .bid(newAuctionId, encryptedAmount.handles[0], encryptedAmount.inputProof)
      ).to.be.rejected;
    });

    it("should revert if auction has ended", async function () {
      const auctionData = await auction.getAuction(auctionId);
      await time.increaseTo(auctionData.endTime + BigInt(1));

      const encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.bob.address)
        .add64(100000n)
        .encrypt();

      await expect(
        auction
          .connect(signers.bob)
          .bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof)
      ).to.be.rejected;
    });
  });

  describe("Claiming (Unified Interface)", function () {
    let auctionId: number;
    let endTime: number;

    beforeEach(async function () {
      const now = await time.latest();
      const startTime = now + 100;
      endTime = startTime + 3600;

      await auction.connect(signers.alice).createAuction("QmClaimTest", startTime, endTime, {
        value: ethers.parseEther("0.01"),
      });

      auctionId = 0;
      await time.increaseTo(startTime);

      // Bob bids 100,000
      let encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.bob.address)
        .add64(100000n)
        .encrypt();
      await auction.connect(signers.bob).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      // Charlie bids 200,000 (winner)
      encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.charlie.address)
        .add64(200000n)
        .encrypt();
      await auction.connect(signers.charlie).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      await time.increaseTo(endTime + 1);
    });

    it("should allow winner to claim and transfer tokens to seller", async function () {
      const aliceBalanceBefore = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.alice.address),
        tokenAddress,
        signers.alice
      );

      // Charlie (winner) claims
      await auction.connect(signers.charlie).claim(auctionId, {
        value: ethers.parseEther("0.05"),
      });

      // Alice should receive 200,000 tokens
      const aliceBalanceAfter = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.alice.address),
        tokenAddress,
        signers.alice
      );

      expect(aliceBalanceAfter).to.equal(aliceBalanceBefore + 200000n);

      // Charlie's hasClaimed should be true
      expect(await auction.hasClaimed(auctionId, signers.charlie.address)).to.be.true;
    });

    it("should refund tokens to loser", async function () {
      const bobBalanceBefore = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.bob.address),
        tokenAddress,
        signers.bob
      );

      // Bob (loser) claims - tokens should be refunded
      await auction.connect(signers.bob).claim(auctionId, {
        value: ethers.parseEther("0.05"),
      });

      // Bob should get his 100,000 tokens back
      const bobBalanceAfter = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.bob.address),
        tokenAddress,
        signers.bob
      );

      expect(bobBalanceAfter).to.equal(bobBalanceBefore + 100000n);
    });

    it("should allow loser to withdraw stake after claiming", async function () {
      // Bob claims (loser - tokens refunded)
      await auction.connect(signers.bob).claim(auctionId, {
        value: ethers.parseEther("0.05"),
      });

      expect(await auction.hasClaimed(auctionId, signers.bob.address)).to.be.true;
      expect(await auction.stakes(auctionId, signers.bob.address)).to.equal(ethers.parseEther("0.05"));

      // Bob withdraws stake
      await auction.connect(signers.bob).withdrawStake(auctionId);

      expect(await auction.stakes(auctionId, signers.bob.address)).to.equal(0);
    });

    it("should revert if claiming without stake", async function () {
      await expect(
        auction.connect(signers.bob).claim(auctionId, {
          value: ethers.parseEther("0.01"), // Too low
        })
      ).to.be.revertedWith("Must stake 0.05 ETH");
    });

    it("should revert if no bid to claim", async function () {
      // Dave didn't bid
      await expect(
        auction.connect(signers.dave).claim(auctionId, {
          value: ethers.parseEther("0.05"),
        })
      ).to.be.revertedWith("No bid to claim");
    });

    it("should revert if already claimed", async function () {
      await auction.connect(signers.bob).claim(auctionId, {
        value: ethers.parseEther("0.05"),
      });

      await expect(
        auction.connect(signers.bob).claim(auctionId, {
          value: ethers.parseEther("0.05"),
        })
      ).to.be.revertedWith("Already claimed");
    });

    it("should revert if auction hasn't ended", async function () {
      const now = await time.latest();
      const startTime = now + 100;
      const futureEnd = startTime + 7200;

      await auction.connect(signers.alice).createAuction("QmFuture", startTime, futureEnd, {
        value: ethers.parseEther("0.01"),
      });

      const newId = 1;
      await time.increaseTo(startTime);

      let encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.bob.address)
        .add64(100000n)
        .encrypt();
      await auction.connect(signers.bob).bid(newId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      await expect(
        auction.connect(signers.bob).claim(newId, {
          value: ethers.parseEther("0.05"),
        })
      ).to.be.rejected;
    });

    it("should revert withdrawStake if not claimed yet", async function () {
      await expect(
        auction.connect(signers.bob).withdrawStake(auctionId)
      ).to.be.revertedWith("Must claim first");
    });

    it("should revert withdrawStake if no stake", async function () {
      await auction.connect(signers.bob).claim(auctionId, {
        value: ethers.parseEther("0.05"),
      });

      // Withdraw first time - ok
      await auction.connect(signers.bob).withdrawStake(auctionId);

      // Withdraw second time - no stake
      await expect(
        auction.connect(signers.bob).withdrawStake(auctionId)
      ).to.be.revertedWith("No stake to withdraw");
    });
  });

  describe("FHE Security: Winner vs Loser Verification", function () {
    it("should correctly route tokens: winner to seller, loser to self", async function () {
      const now = await time.latest();
      const startTime = now + 100;
      const endTime = startTime + 3600;

      await auction.connect(signers.alice).createAuction("QmSecurityTest", startTime, endTime, {
        value: ethers.parseEther("0.01"),
      });

      const auctionId = 0;
      await time.increaseTo(startTime);

      // Bob bids 100,000 (loser)
      let encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.bob.address)
        .add64(100000n)
        .encrypt();
      await auction.connect(signers.bob).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      // Charlie bids 250,000 (winner)
      encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.charlie.address)
        .add64(250000n)
        .encrypt();
      await auction.connect(signers.charlie).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      // Dave bids 150,000 (loser)
      encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.dave.address)
        .add64(150000n)
        .encrypt();
      await auction.connect(signers.dave).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      await time.increaseTo(endTime + 1);

      // Record balances before claiming
      const aliceBefore = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.alice.address), tokenAddress, signers.alice);
      const bobBefore = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.bob.address), tokenAddress, signers.bob);
      const charlieBefore = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.charlie.address), tokenAddress, signers.charlie);
      const daveBefore = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.dave.address), tokenAddress, signers.dave);

      // All three claim
      await auction.connect(signers.bob).claim(auctionId, { value: ethers.parseEther("0.05") });
      await auction.connect(signers.charlie).claim(auctionId, { value: ethers.parseEther("0.05") });
      await auction.connect(signers.dave).claim(auctionId, { value: ethers.parseEther("0.05") });

      // Verify results
      const aliceAfter = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.alice.address), tokenAddress, signers.alice);
      const bobAfter = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.bob.address), tokenAddress, signers.bob);
      const charlieAfter = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.charlie.address), tokenAddress, signers.charlie);
      const daveAfter = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.dave.address), tokenAddress, signers.dave);

      // Alice (seller) receives Charlie's bid (250,000)
      expect(aliceAfter).to.equal(aliceBefore + 250000n);

      // Bob (loser) gets refund (+100,000)
      expect(bobAfter).to.equal(bobBefore + 100000n);

      // Charlie (winner) - balance stays same (no refund, tokens already in contract)
      expect(charlieAfter).to.equal(charlieBefore);

      // Dave (loser) gets refund (+150,000)
      expect(daveAfter).to.equal(daveBefore + 150000n);
    });

    it("should not allow fake winner to steal tokens", async function () {
      // This test verifies that even without a claimWinner mechanism,
      // the FHE.eq check ensures only the real winner's tokens go to the seller
      const now = await time.latest();
      const startTime = now + 100;
      const endTime = startTime + 3600;

      await auction.connect(signers.alice).createAuction("QmFakeTest", startTime, endTime, {
        value: ethers.parseEther("0.01"),
      });

      const auctionId = 0;
      await time.increaseTo(startTime);

      // Bob bids 100,000
      let encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.bob.address)
        .add64(100000n)
        .encrypt();
      await auction.connect(signers.bob).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      // Charlie bids 250,000 (real winner)
      encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.charlie.address)
        .add64(250000n)
        .encrypt();
      await auction.connect(signers.charlie).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      await time.increaseTo(endTime + 1);

      const aliceBefore = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.alice.address), tokenAddress, signers.alice);

      // Bob (fake winner attempt) claims first
      await auction.connect(signers.bob).claim(auctionId, { value: ethers.parseEther("0.05") });

      // Alice should NOT receive Bob's bid (because Bob is not the winner)
      const aliceAfterBob = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.alice.address), tokenAddress, signers.alice);
      expect(aliceAfterBob).to.equal(aliceBefore); // No change

      // Charlie (real winner) claims
      await auction.connect(signers.charlie).claim(auctionId, { value: ethers.parseEther("0.05") });

      // Now Alice receives Charlie's bid (250,000)
      const aliceAfterCharlie = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.alice.address), tokenAddress, signers.alice);
      expect(aliceAfterCharlie).to.equal(aliceBefore + 250000n);
    });
  });

  describe("Fee Withdrawal", function () {
    it("should allow owner to withdraw fees", async function () {
      const now = await time.latest();
      await auction.connect(signers.alice).createAuction("QmFeeTest", now + 100, now + 3700, {
        value: ethers.parseEther("0.01"),
      });

      const tx = await auction.connect(signers.deployer).withdrawFees();
      const receipt = await tx.wait();
      expect(receipt).to.not.be.undefined;
    });

    it("should emit FeesWithdrawn event", async function () {
      const now = await time.latest();
      await auction.connect(signers.alice).createAuction("QmFeeEvent", now + 100, now + 3700, {
        value: ethers.parseEther("0.01"),
      });

      await expect(auction.connect(signers.deployer).withdrawFees())
        .to.emit(auction, "FeesWithdrawn")
        .withArgs(signers.deployer.address, ethers.parseEther("0.01"));
    });

    it("should revert if non-owner tries to withdraw", async function () {
      const now = await time.latest();
      await auction.connect(signers.alice).createAuction("QmFeeAuth", now + 100, now + 3700, {
        value: ethers.parseEther("0.01"),
      });

      await expect(
        auction.connect(signers.alice).withdrawFees()
      ).to.be.rejected;
    });

    it("should revert if no fees to withdraw", async function () {
      await expect(
        auction.connect(signers.deployer).withdrawFees()
      ).to.be.revertedWith("No fees to withdraw");
    });
  });

  describe("Complete Auction Flow", function () {
    it("should complete full auction lifecycle", async function () {
      // 1. Alice creates auction
      const now = await time.latest();
      const startTime = now + 100;
      const endTime = startTime + 3600;

      await auction.connect(signers.alice).createAuction("QmFullTest", startTime, endTime, {
        value: ethers.parseEther("0.01"),
      });

      const auctionId = 0;
      await time.increaseTo(startTime);

      // 2. Multiple users bid
      let encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.bob.address)
        .add64(100000n)
        .encrypt();
      await auction.connect(signers.bob).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.charlie.address)
        .add64(250000n)
        .encrypt();
      await auction.connect(signers.charlie).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.dave.address)
        .add64(150000n)
        .encrypt();
      await auction.connect(signers.dave).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      // 3. Auction ends
      await time.increaseTo(endTime + 1);

      // Record balances
      const aliceBefore = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.alice.address), tokenAddress, signers.alice);
      const bobBefore = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.bob.address), tokenAddress, signers.bob);
      const charlieBefore = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.charlie.address), tokenAddress, signers.charlie);
      const daveBefore = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.dave.address), tokenAddress, signers.dave);

      // 4. All users claim (unified interface)
      await auction.connect(signers.bob).claim(auctionId, { value: ethers.parseEther("0.05") });
      await auction.connect(signers.charlie).claim(auctionId, { value: ethers.parseEther("0.05") });
      await auction.connect(signers.dave).claim(auctionId, { value: ethers.parseEther("0.05") });

      // 5. Losers withdraw stake
      await auction.connect(signers.bob).withdrawStake(auctionId);
      await auction.connect(signers.dave).withdrawStake(auctionId);

      // 6. Verify final balances
      const aliceAfter = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.alice.address), tokenAddress, signers.alice);
      const bobAfter = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.bob.address), tokenAddress, signers.bob);
      const charlieAfter = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.charlie.address), tokenAddress, signers.charlie);
      const daveAfter = await fhevm.userDecryptEuint(FhevmType.euint64, await token.confidentialBalanceOf(signers.dave.address), tokenAddress, signers.dave);

      // Alice received 250,000 from Charlie (winner)
      expect(aliceAfter).to.equal(aliceBefore + 250000n);

      // Bob got refund (loser)
      expect(bobAfter).to.equal(bobBefore + 100000n);

      // Charlie (winner) - balance stays same (no refund, tokens already in contract)
      expect(charlieAfter).to.equal(charlieBefore);

      // Dave got refund (loser)
      expect(daveAfter).to.equal(daveBefore + 150000n);

      // 7. Owner withdraws fees (0.01 listing + 0.05 winner's stake)
      await auction.connect(signers.deployer).withdrawFees();
    });
  });
});
