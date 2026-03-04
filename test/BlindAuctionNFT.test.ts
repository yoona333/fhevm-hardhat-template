import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { MySecretToken, BlindAuction, TokenExchange } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  seller: HardhatEthersSigner;
  bidder1: HardhatEthersSigner;
  bidder2: HardhatEthersSigner;
  bidder3: HardhatEthersSigner;
};

async function deployFixture() {
  // Deploy MySecretToken
  const MySecretTokenFactory = await ethers.getContractFactory("MySecretToken");
  const mySecretToken = (await MySecretTokenFactory.deploy(
    "Secret Auction Token",
    "SAT",
    "ipfs://QmTest"
  )) as MySecretToken;
  const tokenAddress = await mySecretToken.getAddress();

  // Deploy TokenExchange
  const TokenExchangeFactory = await ethers.getContractFactory("TokenExchange");
  const tokenExchange = (await TokenExchangeFactory.deploy(tokenAddress)) as TokenExchange;
  const exchangeAddress = await tokenExchange.getAddress();

  // Deploy BlindAuction with NFT parameters
  const BlindAuctionFactory = await ethers.getContractFactory("BlindAuction");
  const blindAuction = (await BlindAuctionFactory.deploy(
    tokenAddress,
    "BlindAuction NFT",
    "BANFT"
  )) as BlindAuction;
  const auctionAddress = await blindAuction.getAddress();

  return {
    mySecretToken,
    tokenAddress,
    tokenExchange,
    exchangeAddress,
    blindAuction,
    auctionAddress,
  };
}

describe("BlindAuction NFT Tests", function () {
  let signers: Signers;
  let mySecretToken: MySecretToken;
  let tokenAddress: string;
  let tokenExchange: TokenExchange;
  let blindAuction: BlindAuction;
  let auctionAddress: string;

  const LISTING_FEE = ethers.parseEther("0.01");
  const SUCCESS_FEE = ethers.parseEther("0.05");
  const MINT_AMOUNT = 10_000_000n; // 10 million tokens

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = {
      deployer: ethSigners[0],
      seller: ethSigners[1],
      bidder1: ethSigners[2],
      bidder2: ethSigners[3],
      bidder3: ethSigners[4],
    };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite can only run on FHEVM mock environment");
      this.skip();
    }

    ({ mySecretToken, tokenAddress, tokenExchange, blindAuction, auctionAddress } = await deployFixture());

    // Setup: Set TokenExchange as minter
    await mySecretToken.setMinter(await tokenExchange.getAddress());

    // Mint tokens for test accounts
    const recipients = [
      await signers.seller.getAddress(),
      await signers.bidder1.getAddress(),
      await signers.bidder2.getAddress(),
      await signers.bidder3.getAddress(),
    ];
    await mySecretToken.setMinter(await signers.deployer.getAddress());
    await mySecretToken.mintBatch(recipients, MINT_AMOUNT);
  });

  describe("NFT Minting on Auction Creation", function () {
    it("Should mint NFT when creating auction", async function () {
      const metadataCID = "QmTestMetadata123";
      const block = await ethers.provider.getBlock("latest");
      const startTime = block!.timestamp + 60;
      const endTime = startTime + 3600;
      const minimumBid = 1000n;

      const tx = await blindAuction
        .connect(signers.seller)
        .createAuction(metadataCID, startTime, endTime, minimumBid, {
          value: LISTING_FEE,
        });

      await tx.wait();

      // Check NFT was minted
      const auctionId = 0n;
      const auction = await blindAuction.auctions(auctionId);
      const nftTokenId = auction.nftTokenId;

      expect(nftTokenId).to.equal(auctionId); // Token ID = Auction ID

      // Check NFT is owned by contract
      const nftOwner = await blindAuction.ownerOf(nftTokenId);
      expect(nftOwner).to.equal(auctionAddress);

      // Check token URI
      const tokenURI = await blindAuction.tokenURI(nftTokenId);
      expect(tokenURI).to.equal(`ipfs://${metadataCID}`);

      // Check nftClaimed is false
      expect(auction.nftClaimed).to.be.false;
    });

    it("Should mint unique NFT for each auction", async function () {
      const metadataCID1 = "QmTest1";
      const metadataCID2 = "QmTest2";
      const block = await ethers.provider.getBlock("latest");
      const startTime = block!.timestamp + 60;
      const endTime = startTime + 3600;
      const minimumBid = 1000n;

      // Create first auction
      await blindAuction
        .connect(signers.seller)
        .createAuction(metadataCID1, startTime, endTime, minimumBid, {
          value: LISTING_FEE,
        });

      // Create second auction
      await blindAuction
        .connect(signers.seller)
        .createAuction(metadataCID2, startTime, endTime, minimumBid, {
          value: LISTING_FEE,
        });

      // Check both NFTs exist
      const auction0 = await blindAuction.auctions(0n);
      const auction1 = await blindAuction.auctions(1n);

      expect(auction0.nftTokenId).to.equal(0n);
      expect(auction1.nftTokenId).to.equal(1n);

      const owner0 = await blindAuction.ownerOf(0n);
      const owner1 = await blindAuction.ownerOf(1n);

      expect(owner0).to.equal(auctionAddress);
      expect(owner1).to.equal(auctionAddress);
    });
  });

  describe("claimNFT Function", function () {
    let auctionId: bigint;

    beforeEach(async function () {
      this.timeout(60000);

      // Create auction
      const metadataCID = "QmTestMetadata";
      const block = await ethers.provider.getBlock("latest");
      const startTime = block!.timestamp + 10;
      const endTime = startTime + 100;
      const minimumBid = 1000n;

      const tx = await blindAuction
        .connect(signers.seller)
        .createAuction(metadataCID, startTime, endTime, minimumBid, {
          value: LISTING_FEE,
        });
      await tx.wait();

      auctionId = 0n;

      // Fast forward to auction start
      await ethers.provider.send("evm_increaseTime", [15]);
      await ethers.provider.send("evm_mine", []);

      // Approve BlindAuction to spend tokens
      const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      await mySecretToken.connect(signers.bidder1).setOperator(auctionAddress, expiry);
      await mySecretToken.connect(signers.bidder2).setOperator(auctionAddress, expiry);

      // Bidder1 bids 5000
      const encryptedAmount1 = await fhevm
        .createEncryptedInput(auctionAddress, await signers.bidder1.getAddress())
        .add64(5000n)
        .encrypt();
      await blindAuction
        .connect(signers.bidder1)
        .bid(auctionId, encryptedAmount1.handles[0], encryptedAmount1.inputProof);

      // Bidder2 bids 3000
      const encryptedAmount2 = await fhevm
        .createEncryptedInput(auctionAddress, await signers.bidder2.getAddress())
        .add64(3000n)
        .encrypt();
      await blindAuction
        .connect(signers.bidder2)
        .bid(auctionId, encryptedAmount2.handles[0], encryptedAmount2.inputProof);

      // Wait for auction to end
      await ethers.provider.send("evm_increaseTime", [101]);
      await ethers.provider.send("evm_mine", []);
    });

    it("Should allow winner to claim NFT and settle fees", async function () {
      // Both bidders claim to determine winner
      await blindAuction.connect(signers.bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(signers.bidder2).claim(auctionId, { value: SUCCESS_FEE });

      const auction = await blindAuction.auctions(auctionId);
      const winner = auction.winner;

      expect(winner).to.equal(await signers.bidder1.getAddress()); // Bidder1 bid higher

      // Winner claims NFT
      await blindAuction.connect(signers.bidder1).claimNFT(auctionId);

      // Check NFT transferred to winner
      const nftOwner = await blindAuction.ownerOf(auction.nftTokenId);
      expect(nftOwner).to.equal(await signers.bidder1.getAddress());

      // Check nftClaimed flag
      const updatedAuction = await blindAuction.auctions(auctionId);
      expect(updatedAuction.nftClaimed).to.be.true;
    });

    it("Should prevent non-winner from claiming NFT", async function () {
      // Both bidders claim
      await blindAuction.connect(signers.bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(signers.bidder2).claim(auctionId, { value: SUCCESS_FEE });

      // Bidder2 (loser) tries to claim NFT
      await expect(blindAuction.connect(signers.bidder2).claimNFT(auctionId)).to.be.revertedWith(
        "Not the winner"
      );
    });

    it("Should prevent double claiming NFT", async function () {
      // Claim to determine winner
      await blindAuction.connect(signers.bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(signers.bidder2).claim(auctionId, { value: SUCCESS_FEE });

      // Winner claims NFT once
      await blindAuction.connect(signers.bidder1).claimNFT(auctionId);

      // Try to claim again
      await expect(blindAuction.connect(signers.bidder1).claimNFT(auctionId)).to.be.revertedWith(
        "NFT already claimed"
      );
    });

    it("Should emit NFTClaimed event", async function () {
      await blindAuction.connect(signers.bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(signers.bidder2).claim(auctionId, { value: SUCCESS_FEE });

      const auction = await blindAuction.auctions(auctionId);

      await expect(blindAuction.connect(signers.bidder1).claimNFT(auctionId))
        .to.emit(blindAuction, "NFTClaimed")
        .withArgs(auctionId, await signers.bidder1.getAddress(), auction.nftTokenId);
    });

    it("Should prevent claiming NFT before auction ends", async function () {
      // Create a new auction that hasn't ended
      const metadataCID = "QmTest";
      const block = await ethers.provider.getBlock("latest");
      const startTime = block!.timestamp + 10;
      const endTime = startTime + 3600; // Long duration

      await blindAuction.connect(signers.seller).createAuction(metadataCID, startTime, endTime, 1000n, {
        value: LISTING_FEE,
      });

      const newAuctionId = 1n;

      // Fast forward to start
      await ethers.provider.send("evm_increaseTime", [15]);
      await ethers.provider.send("evm_mine", []);

      // Place bid with approval
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      await mySecretToken.connect(signers.bidder1).setOperator(auctionAddress, expiry);
      const encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, await signers.bidder1.getAddress())
        .add64(5000n)
        .encrypt();
      await blindAuction
        .connect(signers.bidder1)
        .bid(newAuctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);

      // This should revert because auction hasn't ended
      await expect(blindAuction.connect(signers.bidder1).claimNFT(newAuctionId)).to.be.reverted;
    });
  });

  describe("ERC721 Compliance", function () {
    it("Should support ERC721 interfaces", async function () {
      // ERC721 interface ID: 0x80ac58cd
      const ERC721_INTERFACE_ID = "0x80ac58cd";
      const supportsERC721 = await blindAuction.supportsInterface(ERC721_INTERFACE_ID);
      expect(supportsERC721).to.be.true;
    });

    it("Should track NFT balance correctly", async function () {
      // Create auction (mints NFT to contract)
      const metadataCID = "QmTest";
      const block = await ethers.provider.getBlock("latest");
      const startTime = block!.timestamp + 60;
      const endTime = startTime + 3600;

      await blindAuction.connect(signers.seller).createAuction(metadataCID, startTime, endTime, 1000n, {
        value: LISTING_FEE,
      });

      // Check contract balance
      const contractBalance = await blindAuction.balanceOf(auctionAddress);
      expect(contractBalance).to.equal(1n);
    });

    it("Should implement onERC721Received", async function () {
      // This is tested implicitly by NFT minting working
      const metadataCID = "QmTest";
      const block = await ethers.provider.getBlock("latest");
      const startTime = block!.timestamp + 60;
      const endTime = startTime + 3600;

      // If onERC721Received wasn't implemented, this would revert
      await expect(
        blindAuction.connect(signers.seller).createAuction(metadataCID, startTime, endTime, 1000n, {
          value: LISTING_FEE,
        })
      ).to.not.be.reverted;
    });
  });

  describe("No Logistics Functions", function () {
    it("Should not have confirmShipment function", async function () {
      // @ts-expect-error - Function should not exist
      expect(blindAuction.confirmShipment).to.be.undefined;
    });

    it("Should not have confirmReceipt function", async function () {
      // @ts-expect-error - Function should not exist
      expect(blindAuction.confirmReceipt).to.be.undefined;
    });

    it("Should not have withdrawEscrow function", async function () {
      // @ts-expect-error - Function should not exist
      expect(blindAuction.withdrawEscrow).to.be.undefined;
    });

    it("Should not have raiseDispute function", async function () {
      // @ts-expect-error - Function should not exist
      expect(blindAuction.raiseDispute).to.be.undefined;
    });
  });

  describe("Complete Auction Flow", function () {
    it("Should complete full NFT auction cycle", async function () {
      this.timeout(60000);

      // 1. Create auction (mints NFT)
      const metadataCID = "QmCompleteTest";
      const block = await ethers.provider.getBlock("latest");
      const startTime = block!.timestamp + 10;
      const endTime = startTime + 100;
      const minimumBid = 1000n;

      await blindAuction.connect(signers.seller).createAuction(metadataCID, startTime, endTime, minimumBid, {
        value: LISTING_FEE,
      });

      const auctionId = 0n;
      const auction = await blindAuction.auctions(auctionId);

      // Verify NFT minted and locked in contract
      expect(await blindAuction.ownerOf(auction.nftTokenId)).to.equal(auctionAddress);

      // 2. Wait for auction to start and place bids
      await ethers.provider.send("evm_increaseTime", [15]);
      await ethers.provider.send("evm_mine", []);

      const expiry = Math.floor(Date.now() / 1000) + 3600;
      await mySecretToken.connect(signers.bidder1).setOperator(auctionAddress, expiry);
      await mySecretToken.connect(signers.bidder2).setOperator(auctionAddress, expiry);

      const encryptedAmount1 = await fhevm
        .createEncryptedInput(auctionAddress, await signers.bidder1.getAddress())
        .add64(5000n)
        .encrypt();
      await blindAuction
        .connect(signers.bidder1)
        .bid(auctionId, encryptedAmount1.handles[0], encryptedAmount1.inputProof);

      const encryptedAmount2 = await fhevm
        .createEncryptedInput(auctionAddress, await signers.bidder2.getAddress())
        .add64(3000n)
        .encrypt();
      await blindAuction
        .connect(signers.bidder2)
        .bid(auctionId, encryptedAmount2.handles[0], encryptedAmount2.inputProof);

      // 3. Wait for auction to end
      await ethers.provider.send("evm_increaseTime", [101]);
      await ethers.provider.send("evm_mine", []);

      // 4. Bidders claim to determine winner
      await blindAuction.connect(signers.bidder1).claim(auctionId, { value: SUCCESS_FEE });
      await blindAuction.connect(signers.bidder2).claim(auctionId, { value: SUCCESS_FEE });

      const updatedAuction = await blindAuction.auctions(auctionId);
      expect(updatedAuction.winner).to.equal(await signers.bidder1.getAddress());

      // 5. Winner claims NFT
      await blindAuction.connect(signers.bidder1).claimNFT(auctionId);

      // 6. Verify NFT transferred to winner
      expect(await blindAuction.ownerOf(auction.nftTokenId)).to.equal(await signers.bidder1.getAddress());

      // 7. Verify nftClaimed flag
      const finalAuction = await blindAuction.auctions(auctionId);
      expect(finalAuction.nftClaimed).to.be.true;
    });
  });
});
