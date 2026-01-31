import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { MySecretToken, TokenExchange } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  // Deploy token
  const TokenFactory = await ethers.getContractFactory("MySecretToken");
  const token = (await TokenFactory.deploy(
    "Secret Auction Token",
    "SAT",
    "ipfs://test"
  )) as MySecretToken;
  const tokenAddress = await token.getAddress();

  // Deploy exchange
  const ExchangeFactory = await ethers.getContractFactory("TokenExchange");
  const exchange = (await ExchangeFactory.deploy(tokenAddress)) as TokenExchange;
  const exchangeAddress = await exchange.getAddress();

  // Transfer token ownership to exchange
  await token.transferOwnership(exchangeAddress);

  return { token, tokenAddress, exchange, exchangeAddress };
}

describe("TokenExchange", function () {
  let signers: Signers;
  let token: MySecretToken;
  let tokenAddress: string;
  let exchange: TokenExchange;
  let exchangeAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite can only run on FHEVM mock environment");
      this.skip();
    }

    ({ token, tokenAddress, exchange, exchangeAddress } = await deployFixture());
  });

  describe("Deployment", function () {
    it("should set the correct token address", async function () {
      expect(await exchange.token()).to.equal(tokenAddress);
    });

    it("should set the deployer as owner", async function () {
      expect(await exchange.owner()).to.equal(signers.deployer.address);
    });

    it("should have correct exchange rate", async function () {
      expect(await exchange.EXCHANGE_RATE()).to.equal(1000000n);
    });

    it("should start with zero ETH reserve", async function () {
      expect(await exchange.ethReserve()).to.equal(0n);
    });
  });

  describe("Buying Tokens", function () {
    it("should allow users to buy tokens with ETH", async function () {
      const ethAmount = ethers.parseEther("1"); // 1 ETH

      await exchange.connect(signers.alice).buyTokens({ value: ethAmount });

      // Check ETH reserve
      expect(await exchange.ethReserve()).to.equal(ethAmount);

      // Check Alice's token balance
      const encryptedBalance = await token.confidentialBalanceOf(signers.alice.address);
      const balance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encryptedBalance,
        tokenAddress,
        signers.alice
      );

      expect(balance).to.equal(1000000n); // 1 ETH = 1,000,000 tokens
    });

    it("should calculate token amount correctly", async function () {
      const ethAmount = ethers.parseEther("0.5");
      const expectedTokens = await exchange.calculateTokenAmount(ethAmount);

      expect(expectedTokens).to.equal(500000n); // 0.5 ETH = 500,000 tokens
    });

    it("should revert if no ETH is sent", async function () {
      await expect(
        exchange.connect(signers.alice).buyTokens({ value: 0 })
      ).to.be.revertedWith("Must send ETH");
    });

    it("should handle multiple purchases", async function () {
      await exchange.connect(signers.alice).buyTokens({
        value: ethers.parseEther("0.1"),
      });

      await exchange.connect(signers.bob).buyTokens({
        value: ethers.parseEther("0.2"),
      });

      // Check total ETH reserve
      expect(await exchange.ethReserve()).to.equal(ethers.parseEther("0.3"));

      // Check individual balances
      const aliceBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.alice.address),
        tokenAddress,
        signers.alice
      );

      const bobBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.bob.address),
        tokenAddress,
        signers.bob
      );

      expect(aliceBalance).to.equal(100000n);
      expect(bobBalance).to.equal(200000n);
    });
  });

  describe("Redeeming Tokens", function () {
    beforeEach(async function () {
      // Add ETH reserve
      await exchange.connect(signers.deployer).addReserve({
        value: ethers.parseEther("10"),
      });

      // Alice buys tokens
      await exchange.connect(signers.alice).buyTokens({
        value: ethers.parseEther("1"),
      });
    });

    it("should allow users to redeem tokens for ETH", async function () {
      const tokenAmount = 100000n; // 0.1 ETH worth
      const expectedETH = await exchange.calculateEthAmount(tokenAmount);

      // Alice sets exchange as operator
      const oneYear = Math.floor(Date.now() / 1000) + 365 * 86400;
      await token.connect(signers.alice).setOperator(exchangeAddress, oneYear);

      const aliceEthBefore = await ethers.provider.getBalance(signers.alice.address);

      const tx = await exchange.connect(signers.alice).redeemTokens(tokenAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const aliceEthAfter = await ethers.provider.getBalance(signers.alice.address);

      expect(aliceEthAfter + gasUsed).to.be.closeTo(
        aliceEthBefore + expectedETH,
        ethers.parseEther("0.0001") // Allow small difference for gas
      );
    });

    it("should calculate ETH amount correctly", async function () {
      const tokenAmount = 500000n; // Should be 0.5 ETH
      const ethAmount = await exchange.calculateEthAmount(tokenAmount);

      expect(ethAmount).to.equal(ethers.parseEther("0.5"));
    });

    it("should revert if insufficient reserve", async function () {
      const tokenAmount = 20000000n; // 20 ETH worth, but only 11 ETH in reserve

      const oneYear = Math.floor(Date.now() / 1000) + 365 * 86400;
      await token.connect(signers.alice).setOperator(exchangeAddress, oneYear);

      await expect(
        exchange.connect(signers.alice).redeemTokens(tokenAmount)
      ).to.be.revertedWith("Insufficient reserve");
    });

    it("should revert if amount is zero", async function () {
      await expect(exchange.connect(signers.alice).redeemTokens(0)).to.be.revertedWith(
        "Amount must be positive"
      );
    });
  });

  describe("Reserve Management", function () {
    it("should allow owner to add reserve", async function () {
      const addAmount = ethers.parseEther("5");

      await exchange.connect(signers.deployer).addReserve({ value: addAmount });

      expect(await exchange.ethReserve()).to.equal(addAmount);
    });

    it("should allow owner to withdraw reserve", async function () {
      // Add reserve first
      await exchange.connect(signers.deployer).addReserve({
        value: ethers.parseEther("5"),
      });

      const withdrawAmount = ethers.parseEther("2");
      const ownerBalanceBefore = await ethers.provider.getBalance(signers.deployer.address);

      const tx = await exchange.connect(signers.deployer).withdrawReserve(withdrawAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const ownerBalanceAfter = await ethers.provider.getBalance(signers.deployer.address);

      expect(ownerBalanceAfter + gasUsed).to.be.closeTo(
        ownerBalanceBefore + withdrawAmount,
        ethers.parseEther("0.0001")
      );

      expect(await exchange.ethReserve()).to.equal(ethers.parseEther("3"));
    });

    it("should revert if non-owner tries to add reserve", async function () {
      await expect(
        exchange.connect(signers.alice).addReserve({ value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(exchange, "OnlyOwner");
    });

    it("should revert if non-owner tries to withdraw reserve", async function () {
      await exchange.connect(signers.deployer).addReserve({
        value: ethers.parseEther("5"),
      });

      await expect(
        exchange.connect(signers.alice).withdrawReserve(ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(exchange, "OnlyOwner");
    });

    it("should revert if trying to withdraw more than reserve", async function () {
      await exchange.connect(signers.deployer).addReserve({
        value: ethers.parseEther("5"),
      });

      await expect(
        exchange.connect(signers.deployer).withdrawReserve(ethers.parseEther("10"))
      ).to.be.revertedWith("Insufficient reserve");
    });
  });

  describe("Events", function () {
    it("should emit TokensPurchased event", async function () {
      const ethAmount = ethers.parseEther("1");

      await expect(exchange.connect(signers.alice).buyTokens({ value: ethAmount }))
        .to.emit(exchange, "TokensPurchased")
        .withArgs(signers.alice.address, ethAmount, 1000000n);
    });

    it("should emit TokensRedeemed event", async function () {
      // Setup
      await exchange.connect(signers.deployer).addReserve({
        value: ethers.parseEther("10"),
      });
      await exchange.connect(signers.alice).buyTokens({
        value: ethers.parseEther("1"),
      });

      const oneYear = Math.floor(Date.now() / 1000) + 365 * 86400;
      await token.connect(signers.alice).setOperator(exchangeAddress, oneYear);

      const tokenAmount = 100000n;
      const ethAmount = await exchange.calculateEthAmount(tokenAmount);

      await expect(exchange.connect(signers.alice).redeemTokens(tokenAmount))
        .to.emit(exchange, "TokensRedeemed")
        .withArgs(signers.alice.address, tokenAmount, ethAmount);
    });
  });
});
