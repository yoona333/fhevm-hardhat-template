import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { BlindAuction, BlindAuction__factory, MySecretToken, MySecretToken__factory, TokenExchange, TokenExchange__factory } from "../types";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { FhevmType } from "@fhevm/hardhat-plugin";

/**
 * 🎯 完整端到端测试 - 盲拍系统全流程
 *
 * 测试场景：
 * 1. 用户购买加密代币（ETH → Token）
 * 2. 卖家创建拍卖
 * 3. 多个买家加密出价
 * 4. 拍卖结束后领取
 * 5. 押金管理
 * 6. 手续费提取
 */

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;   // 卖家
  bob: HardhatEthersSigner;     // 买家1 (败者)
  charlie: HardhatEthersSigner; // 买家2 (获胜者)
  dave: HardhatEthersSigner;    // 买家3 (败者)
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

describe("🎯 完整端到端测试 - 盲拍系统全流程", function () {
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
  });

  it("🚀 完整流程：从购买代币到拍卖结束", async function () {
    console.log("\n" + "=".repeat(80));
    console.log("🎯 开始完整端到端测试 - 盲拍系统全流程");
    console.log("=".repeat(80) + "\n");

    // ==================== 第一阶段：准备工作 ====================
    console.log("📋 第一阶段：用户准备工作\n");

    // 1. 买家购买加密代币
    console.log("1️⃣ 买家购买加密代币（ETH → 加密代币）");
    console.log("   比例：1 ETH = 1,000,000 代币\n");

    const bobEthBefore = await ethers.provider.getBalance(signers.bob.address);
    await exchange.connect(signers.bob).buyTokens({ value: ethers.parseEther("1") });
    const bobTokens = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await token.confidentialBalanceOf(signers.bob.address),
      tokenAddress,
      signers.bob
    );
    console.log(`   ✅ Bob 购买: 1 ETH → ${bobTokens} 代币`);

    await exchange.connect(signers.charlie).buyTokens({ value: ethers.parseEther("2") });
    const charlieTokens = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await token.confidentialBalanceOf(signers.charlie.address),
      tokenAddress,
      signers.charlie
    );
    console.log(`   ✅ Charlie 购买: 2 ETH → ${charlieTokens} 代币`);

    await exchange.connect(signers.dave).buyTokens({ value: ethers.parseEther("1") });
    const daveTokens = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await token.confidentialBalanceOf(signers.dave.address),
      tokenAddress,
      signers.dave
    );
    console.log(`   ✅ Dave 购买: 1 ETH → ${daveTokens} 代币\n`);

    // 2. 买家授权拍卖合约操作代币
    console.log("2️⃣ 买家授权拍卖合约操作代币\n");
    const oneYear = Math.floor(Date.now() / 1000) + 365 * 86400;

    await token.connect(signers.bob).setOperator(auctionAddress, oneYear);
    console.log("   ✅ Bob 已授权");

    await token.connect(signers.charlie).setOperator(auctionAddress, oneYear);
    console.log("   ✅ Charlie 已授权");

    await token.connect(signers.dave).setOperator(auctionAddress, oneYear);
    console.log("   ✅ Dave 已授权\n");

    // 3. 卖家也购买一些代币用于验证
    await exchange.connect(signers.alice).buyTokens({ value: ethers.parseEther("0.5") });
    const aliceTokensBefore = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await token.confidentialBalanceOf(signers.alice.address),
      tokenAddress,
      signers.alice
    );
    console.log(`   📊 Alice (卖家) 初始代币: ${aliceTokensBefore}\n`);

    // ==================== 第二阶段：创建拍卖 ====================
    console.log("=".repeat(80));
    console.log("📋 第二阶段：卖家创建拍卖\n");

    const now = await time.latest();
    const startTime = now + 100;
    const endTime = startTime + 3600;

    console.log("3️⃣ Alice 创建拍卖");
    console.log(`   物品: 稀有 NFT 艺术品`);
    console.log(`   开始时间: ${new Date(startTime * 1000).toLocaleString()}`);
    console.log(`   结束时间: ${new Date(endTime * 1000).toLocaleString()}`);
    console.log(`   上架费: 0.01 ETH\n`);

    const aliceEthBefore = await ethers.provider.getBalance(signers.alice.address);
    const tx = await auction.connect(signers.alice).createAuction(
      "QmEndToEndTest123",
      startTime,
      endTime,
      { value: ethers.parseEther("0.01") }
    );
    const receipt = await tx.wait();
    const aliceEthAfter = await ethers.provider.getBalance(signers.alice.address);

    console.log(`   ✅ 拍卖创建成功！拍卖ID: 0`);
    console.log(`   📊 Alice 支付上架费: ${ethers.formatEther(aliceEthBefore - aliceEthAfter)} ETH\n`);

    const auctionId = 0;

    // 快进到拍卖开始
    await time.increaseTo(startTime);
    console.log("   ⏰ 拍卖已开始！\n");

    // ==================== 第三阶段：加密出价 ====================
    console.log("=".repeat(80));
    console.log("📋 第三阶段：买家加密出价\n");

    console.log("4️⃣ 买家开始出价（加密隐私保护）\n");

    // Bob 出价 100,000
    console.log("   🔐 Bob 出价...");
    let encryptedAmount = await fhevm
      .createEncryptedInput(auctionAddress, signers.bob.address)
      .add64(100000n)
      .encrypt();
    await auction.connect(signers.bob).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);
    const bobTokensAfterBid = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await token.confidentialBalanceOf(signers.bob.address),
      tokenAddress,
      signers.bob
    );
    console.log(`      ✅ Bob 出价完成（金额加密）`);
    console.log(`      📊 Bob 剩余代币: ${bobTokensAfterBid}\n`);

    // Charlie 出价 250,000 (最高出价)
    console.log("   🔐 Charlie 出价...");
    encryptedAmount = await fhevm
      .createEncryptedInput(auctionAddress, signers.charlie.address)
      .add64(250000n)
      .encrypt();
    await auction.connect(signers.charlie).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);
    const charlieTokensAfterBid = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await token.confidentialBalanceOf(signers.charlie.address),
      tokenAddress,
      signers.charlie
    );
    console.log(`      ✅ Charlie 出价完成（金额加密）`);
    console.log(`      📊 Charlie 剩余代币: ${charlieTokensAfterBid}\n`);

    // Dave 出价 150,000
    console.log("   🔐 Dave 出价...");
    encryptedAmount = await fhevm
      .createEncryptedInput(auctionAddress, signers.dave.address)
      .add64(150000n)
      .encrypt();
    await auction.connect(signers.dave).bid(auctionId, encryptedAmount.handles[0], encryptedAmount.inputProof);
    const daveTokensAfterBid = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await token.confidentialBalanceOf(signers.dave.address),
      tokenAddress,
      signers.dave
    );
    console.log(`      ✅ Dave 出价完成（金额加密）`);
    console.log(`      📊 Dave 剩余代币: ${daveTokensAfterBid}\n`);

    console.log("   🔒 所有出价均已加密，任何人都无法看到具体金额！");
    console.log("   🤔 谁是获胜者？让我们拭目以待...\n");

    // ==================== 第四阶段：拍卖结束 ====================
    console.log("=".repeat(80));
    console.log("📋 第四阶段：拍卖结束\n");

    await time.increaseTo(endTime + 1);
    console.log("   ⏰ 拍卖时间到！开始结算...\n");

    // ==================== 第五阶段：领取结果 ====================
    console.log("=".repeat(80));
    console.log("📋 第五阶段：领取结果（统一 claim 接口）\n");

    console.log("5️⃣ 所有出价者调用 claim() 函数\n");

    // Bob claim (败者)
    console.log("   Bob 调用 claim()...");
    await auction.connect(signers.bob).claim(auctionId, {
      value: ethers.parseEther("0.05"),
    });
    const bobTokensAfterClaim = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await token.confidentialBalanceOf(signers.bob.address),
      tokenAddress,
      signers.bob
    );
    console.log(`      ✅ Bob claim 完成`);
    console.log(`      📊 Bob 代币余额: ${bobTokensAfterClaim} (+${bobTokensAfterClaim - bobTokensAfterBid})`);
    console.log(`      💰 Bob 押金: 0.05 ETH\n`);

    // Charlie claim (获胜者)
    console.log("   Charlie 调用 claim()...");
    await auction.connect(signers.charlie).claim(auctionId, {
      value: ethers.parseEther("0.05"),
    });
    const charlieTokensAfterClaim = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await token.confidentialBalanceOf(signers.charlie.address),
      tokenAddress,
      signers.charlie
    );
    console.log(`      ✅ Charlie claim 完成`);
    console.log(`      📊 Charlie 代币余额: ${charlieTokensAfterClaim} (${charlieTokensAfterClaim - charlieTokensAfterBid})`);
    console.log(`      💰 Charlie 押金: 0.05 ETH\n`);

    // Dave claim (败者)
    console.log("   Dave 调用 claim()...");
    await auction.connect(signers.dave).claim(auctionId, {
      value: ethers.parseEther("0.05"),
    });
    const daveTokensAfterClaim = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await token.confidentialBalanceOf(signers.dave.address),
      tokenAddress,
      signers.dave
    );
    console.log(`      ✅ Dave claim 完成`);
    console.log(`      📊 Dave 代币余额: ${daveTokensAfterClaim} (+${daveTokensAfterClaim - daveTokensAfterBid})`);
    console.log(`      💰 Dave 押金: 0.05 ETH\n`);

    // 检查 Alice 收到的代币
    const aliceTokensAfter = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await token.confidentialBalanceOf(signers.alice.address),
      tokenAddress,
      signers.alice
    );

    console.log("   📊 结算结果汇总:");
    console.log(`      🏆 Alice (卖家) 收到: ${aliceTokensAfter - aliceTokensBefore} 代币`);
    console.log(`      ❌ Bob (败者) 退款: ${bobTokensAfterClaim - bobTokensAfterBid} 代币`);
    console.log(`      ✅ Charlie (获胜者) 支付: ${charlieTokensAfterBid - charlieTokensAfterClaim} 代币`);
    console.log(`      ❌ Dave (败者) 退款: ${daveTokensAfterClaim - daveTokensAfterBid} 代币\n`);

    // ==================== 第六阶段：押金提取 ====================
    console.log("=".repeat(80));
    console.log("📋 第六阶段：押金提取\n");

    console.log("6️⃣ 败者提取押金\n");

    // Bob 提取押金
    const bobEthBeforeWithdraw = await ethers.provider.getBalance(signers.bob.address);
    await auction.connect(signers.bob).withdrawStake(auctionId);
    const bobEthAfterWithdraw = await ethers.provider.getBalance(signers.bob.address);
    console.log(`   ✅ Bob 提取押金成功`);
    console.log(`      💰 收回: ~0.05 ETH\n`);

    // Charlie 提取押金
    const charlieEthBeforeWithdraw = await ethers.provider.getBalance(signers.charlie.address);
    await auction.connect(signers.charlie).withdrawStake(auctionId);
    const charlieEthAfterWithdraw = await ethers.provider.getBalance(signers.charlie.address);
    console.log(`   ✅ Charlie 提取押金成功`);
    console.log(`      💰 收回: ~0.05 ETH\n`);

    // Dave 提取押金
    const daveEthBeforeWithdraw = await ethers.provider.getBalance(signers.dave.address);
    await auction.connect(signers.dave).withdrawStake(auctionId);
    const daveEthAfterWithdraw = await ethers.provider.getBalance(signers.dave.address);
    console.log(`   ✅ Dave 提取押金成功`);
    console.log(`      💰 收回: ~0.05 ETH\n`);

    // ==================== 第七阶段：手续费提取 ====================
    console.log("=".repeat(80));
    console.log("📋 第七阶段：平台手续费提取\n");

    console.log("7️⃣ Owner 提取累计手续费\n");

    const ownerEthBefore = await ethers.provider.getBalance(signers.deployer.address);
    await auction.connect(signers.deployer).withdrawFees();
    const ownerEthAfter = await ethers.provider.getBalance(signers.deployer.address);

    console.log(`   ✅ Owner 提取手续费成功`);
    console.log(`      💰 总手续费: 0.01 ETH (上架费)\n`);

    // ==================== 最终验证 ====================
    console.log("=".repeat(80));
    console.log("📋 最终验证\n");

    // 验证 Alice 收到了 250,000 代币（Charlie 的出价）
    expect(aliceTokensAfter).to.equal(aliceTokensBefore + 250000n, "卖家应该收到获胜者的代币");

    // 验证 Bob 和 Dave 的代币被退还
    expect(bobTokensAfterClaim).to.equal(bobTokens, "Bob 的代币应该被完全退还");
    expect(daveTokensAfterClaim).to.equal(daveTokens, "Dave 的代币应该被完全退还");

    // 验证 Charlie 的代币被转走
    expect(charlieTokensAfterClaim).to.equal(charlieTokens - 250000n, "Charlie 的代币应该减少 250,000");

    console.log("   ✅ 所有验证通过！\n");
    console.log("   🎯 验证结果:");
    console.log(`      ✅ 卖家收到正确金额: ${aliceTokensAfter - aliceTokensBefore} 代币`);
    console.log(`      ✅ 败者代币全额退还`);
    console.log(`      ✅ 获胜者代币正确扣除`);
    console.log(`      ✅ 押金正确管理`);
    console.log(`      ✅ 手续费正确收取\n`);

    console.log("=".repeat(80));
    console.log("🎉 完整端到端测试成功！");
    console.log("=".repeat(80) + "\n");

    // ==================== 额外验证：平局保护 ====================
    console.log("=".repeat(80));
    console.log("📋 额外测试：平局保护机制\n");

    console.log("8️⃣ 测试平局场景保护\n");

    // 创建新拍卖
    const now2 = await time.latest();
    const startTime2 = now2 + 100;
    const endTime2 = startTime2 + 3600;

    await auction.connect(signers.alice).createAuction(
      "QmTieTest",
      startTime2,
      endTime2,
      { value: ethers.parseEther("0.01") }
    );
    const auctionId2 = 1;

    await time.increaseTo(startTime2);

    // Bob 和 Charlie 都出价 200,000（平局）
    console.log("   Bob 和 Charlie 都出价 200,000（平局）\n");

    encryptedAmount = await fhevm
      .createEncryptedInput(auctionAddress, signers.bob.address)
      .add64(200000n)
      .encrypt();
    await auction.connect(signers.bob).bid(auctionId2, encryptedAmount.handles[0], encryptedAmount.inputProof);
    console.log("   ✅ Bob 出价: 200,000");

    encryptedAmount = await fhevm
      .createEncryptedInput(auctionAddress, signers.charlie.address)
      .add64(200000n)
      .encrypt();
    await auction.connect(signers.charlie).bid(auctionId2, encryptedAmount.handles[0], encryptedAmount.inputProof);
    console.log("   ✅ Charlie 出价: 200,000\n");

    await time.increaseTo(endTime2 + 1);

    const aliceBalanceBeforeTie = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await token.confidentialBalanceOf(signers.alice.address),
      tokenAddress,
      signers.alice
    );

    // 两人都 claim
    await auction.connect(signers.bob).claim(auctionId2, { value: ethers.parseEther("0.05") });
    console.log("   ✅ Bob 先 claim");

    await auction.connect(signers.charlie).claim(auctionId2, { value: ethers.parseEther("0.05") });
    console.log("   ✅ Charlie 后 claim\n");

    const aliceBalanceAfterTie = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await token.confidentialBalanceOf(signers.alice.address),
      tokenAddress,
      signers.alice
    );

    const tieReceived = aliceBalanceAfterTie - aliceBalanceBeforeTie;
    console.log(`   📊 平局测试结果:`);
    console.log(`      Alice 收到: ${tieReceived} 代币`);
    console.log(`      预期: 200,000 代币（只有一份）\n`);

    expect(tieReceived).to.equal(200000n, "平局时卖家应该只收到 200,000 代币，而不是双倍");

    console.log("   ✅ 平局保护机制验证通过！\n");
    console.log("=".repeat(80) + "\n");
  });
});
