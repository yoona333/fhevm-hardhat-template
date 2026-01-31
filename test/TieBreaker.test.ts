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

describe("BlindAuction - Tie Breaker Test", function () {
  let signers: Signers;
  let token: MySecretToken;
  let tokenAddress: string;
  let exchange: TokenExchange;
  let auction: BlindAuction;
  let auctionAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = {
      deployer: ethSigners[0],
      alice: ethSigners[1],
      bob: ethSigners[2],
      charlie: ethSigners[3],
    };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite can only run on FHEVM mock environment");
      this.skip();
    }

    ({ token, tokenAddress, exchange, auction, auctionAddress } = await deployFixture());

    // Give all users tokens for bidding
    const oneYear = Math.floor(Date.now() / 1000) + 365 * 86400;

    await exchange.connect(signers.bob).buyTokens({ value: ethers.parseEther("1") });
    await token.connect(signers.bob).setOperator(auctionAddress, oneYear);

    await exchange.connect(signers.charlie).buyTokens({ value: ethers.parseEther("1") });
    await token.connect(signers.charlie).setOperator(auctionAddress, oneYear);

    // Alice (seller) also gets tokens for verification
    await exchange.connect(signers.alice).buyTokens({ value: ethers.parseEther("1") });
  });

  describe("Tie Scenario", function () {
    it("✅ FIXED: should handle tie scenario correctly (first-come-first-served)", async function () {
      console.log("\n=== 测试平局场景（修复后）===\n");

      const now = await time.latest();
      const startTime = now + 100;
      const endTime = startTime + 3600;

      // Alice创建拍卖
      await auction.connect(signers.alice).createAuction("QmTieTest", startTime, endTime, {
        value: ethers.parseEther("0.01"),
      });

      const auctionId = 0;
      await time.increaseTo(startTime);

      // Bob 和 Charlie 都出价 200,000（平局！）
      let encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.bob.address)
        .add64(200000n)
        .encrypt();
      await auction.connect(signers.bob).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);
      console.log("✅ Bob 出价: 200,000");

      encryptedAmount = await fhevm
        .createEncryptedInput(auctionAddress, signers.charlie.address)
        .add64(200000n)
        .encrypt();
      await auction.connect(signers.charlie).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);
      console.log("✅ Charlie 出价: 200,000 (平局)");

      await time.increaseTo(endTime + 1);

      // 记录初始余额
      const aliceBalanceBefore = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.alice.address),
        tokenAddress,
        signers.alice
      );
      const bobBalanceBefore = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.bob.address),
        tokenAddress,
        signers.bob
      );
      const charlieBalanceBefore = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.charlie.address),
        tokenAddress,
        signers.charlie
      );

      console.log(`\n初始余额:`);
      console.log(`  Alice (卖家): ${aliceBalanceBefore}`);
      console.log(`  Bob: ${bobBalanceBefore}`);
      console.log(`  Charlie: ${charlieBalanceBefore}`);

      // Bob 先 claim（先到先得）
      await auction.connect(signers.bob).claim(auctionId, {
        value: ethers.parseEther("0.05"),
      });
      console.log("\n✅ Bob 先 claim");

      // Charlie 后 claim（应该被拒绝售出，代币退还）
      await auction.connect(signers.charlie).claim(auctionId, {
        value: ethers.parseEther("0.05"),
      });
      console.log("✅ Charlie 后 claim");

      // 检查最终余额
      const aliceBalanceAfter = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.alice.address),
        tokenAddress,
        signers.alice
      );
      const bobBalanceAfter = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.bob.address),
        tokenAddress,
        signers.bob
      );
      const charlieBalanceAfter = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await token.confidentialBalanceOf(signers.charlie.address),
        tokenAddress,
        signers.charlie
      );

      console.log(`\n最终余额:`);
      console.log(`  Alice (卖家): ${aliceBalanceAfter} (+${aliceBalanceAfter - aliceBalanceBefore})`);
      console.log(`  Bob: ${bobBalanceAfter} (${bobBalanceAfter - bobBalanceBefore >= 0 ? '+' : ''}${bobBalanceAfter - bobBalanceBefore})`);
      console.log(`  Charlie: ${charlieBalanceAfter} (+${charlieBalanceAfter - charlieBalanceBefore})`);

      // ✅ 验证修复效果
      const totalReceived = aliceBalanceAfter - aliceBalanceBefore;
      console.log(`\n🎉 修复验证:`);
      console.log(`  ✅ Alice 总共收到: ${totalReceived} 代币（预期 200,000）`);
      console.log(`  ✅ Bob 代币余额不变 (已在bid时转出，claim时转给卖家)`);
      console.log(`  ✅ Charlie 代币被退还 (+${charlieBalanceAfter - charlieBalanceBefore})`);
      console.log(`  ✅ 平局问题已解决：只有第一个claim的人成功售出！`);

      // 断言验证
      expect(totalReceived).to.equal(200000n, "卖家应该只收到200,000代币");
      expect(bobBalanceAfter).to.equal(bobBalanceBefore, "Bob的代币在bid时已转出，claim时转给卖家，余额不变");
      expect(charlieBalanceAfter).to.equal(charlieBalanceBefore + 200000n, "Charlie的代币应该被退还");

      // 检查押金状态
      const bobStake = await auction.stakes(auctionId, signers.bob.address);
      const charlieStake = await auction.stakes(auctionId, signers.charlie.address);

      console.log(`\n押金状态:`);
      console.log(`  Bob: ${ethers.formatEther(bobStake)} ETH`);
      console.log(`  Charlie: ${ethers.formatEther(charlieStake)} ETH`);

      // 两人都可以提取押金（修复后的设计：不区分获胜者/败者押金）
      await auction.connect(signers.bob).withdrawStake(auctionId);
      console.log("  ✅ Bob 成功提取押金");

      await auction.connect(signers.charlie).withdrawStake(auctionId);
      console.log("  ✅ Charlie 成功提取押金");

      console.log("\n=== 平局漏洞已修复！✅ ===\n");
    });
  });
});
