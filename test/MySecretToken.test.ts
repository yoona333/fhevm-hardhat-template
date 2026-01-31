import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { MySecretToken, MySecretToken__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("MySecretToken")) as MySecretToken__factory;
  const token = (await factory.deploy(
    "Secret Auction Token",
    "SAT",
    "ipfs://test-metadata"
  )) as MySecretToken;
  const tokenAddress = await token.getAddress();

  return { token, tokenAddress };
}

describe("MySecretToken", function () {
  let signers: Signers;
  let token: MySecretToken;
  let tokenAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite can only run on FHEVM mock environment");
      this.skip();
    }

    ({ token, tokenAddress } = await deployFixture());
  });

  describe("Deployment", function () {
    it("should set the correct token name", async function () {
      expect(await token.name()).to.equal("Secret Auction Token");
    });

    it("should set the correct token symbol", async function () {
      expect(await token.symbol()).to.equal("SAT");
    });

    it("should set the deployer as owner", async function () {
      expect(await token.owner()).to.equal(signers.deployer.address);
    });

    it("should have 6 decimals", async function () {
      expect(await token.decimals()).to.equal(6);
    });
  });

  describe("Minting", function () {
    it("should allow owner to mint tokens", async function () {
      const mintAmount = 1000000n; // 1,000,000 tokens

      await token.connect(signers.deployer).mint(signers.alice.address, mintAmount);

      const encryptedBalance = await token.confidentialBalanceOf(signers.alice.address);
      const balance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encryptedBalance,
        tokenAddress,
        signers.alice
      );

      expect(balance).to.equal(mintAmount);
    });

    it("should revert if non-owner tries to mint", async function () {
      const mintAmount = 1000000n;

      await expect(
        token.connect(signers.alice).mint(signers.bob.address, mintAmount)
      ).to.be.rejected;
    });

    it("should allow minting to multiple addresses", async function () {
      const amount1 = 500000n;
      const amount2 = 300000n;

      await token.connect(signers.deployer).mint(signers.alice.address, amount1);
      await token.connect(signers.deployer).mint(signers.bob.address, amount2);

      const balance1 = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.alice.address),
        tokenAddress,
        signers.alice
      );

      const balance2 = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.bob.address),
        tokenAddress,
        signers.bob
      );

      expect(balance1).to.equal(amount1);
      expect(balance2).to.equal(amount2);
    });
  });

  describe("Transfers", function () {
    beforeEach(async function () {
      // Mint 1,000,000 tokens to Alice
      await token.connect(signers.deployer).mint(signers.alice.address, 1000000n);
    });

    it("should allow confidential transfer", async function () {
      const transferAmount = 100000n;

      // Alice transfers to Bob
      const encryptedAmount = await fhevm
        .createEncryptedInput(tokenAddress, signers.alice.address)
        .add64(transferAmount)
        .encrypt();

      await token
        .connect(signers.alice)
        ["confidentialTransfer(address,bytes32,bytes)"](
          signers.bob.address,
          encryptedAmount.handles[0],
          encryptedAmount.inputProof
        );

      // Check balances
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

      expect(aliceBalance).to.equal(900000n);
      expect(bobBalance).to.equal(100000n);
    });

    it("should allow operator transfers", async function () {
      const transferAmount = 50000n;
      const oneYear = Math.floor(Date.now() / 1000) + 365 * 86400;

      // Alice sets Bob as operator
      await token.connect(signers.alice).setOperator(signers.bob.address, oneYear);

      // Bob transfers from Alice to himself
      const encryptedAmount = await fhevm
        .createEncryptedInput(tokenAddress, signers.bob.address)
        .add64(transferAmount)
        .encrypt();

      await token
        .connect(signers.bob)
        ["confidentialTransferFrom(address,address,bytes32,bytes)"](
          signers.alice.address,
          signers.bob.address,
          encryptedAmount.handles[0],
          encryptedAmount.inputProof
        );

      const bobBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.bob.address),
        tokenAddress,
        signers.bob
      );

      expect(bobBalance).to.equal(transferAmount);
    });
  });

  describe("Ownership", function () {
    it("should allow owner to transfer ownership", async function () {
      await token.connect(signers.deployer).transferOwnership(signers.alice.address);

      expect(await token.owner()).to.equal(signers.alice.address);
    });

    it("should revert if non-owner tries to transfer ownership", async function () {
      await expect(
        token.connect(signers.alice).transferOwnership(signers.bob.address)
      ).to.be.rejected;
    });

    it("should revert when transferring to zero address", async function () {
      await expect(
        token.connect(signers.deployer).transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid address");
    });
  });
});
