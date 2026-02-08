import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Minting tokens with account:", deployer.address);

  // Load deployed contract address
  const tokenAddress = "0xAE4b8A28B69Ab86fb905Fc535e0F4B27bbe59243";

  // Get contract instance
  const MySecretToken = await ethers.getContractAt("MySecretToken", tokenAddress);

  // User address to mint to
  const userAddress = "0xc7b0D4dc5184b95Dda276b475dF59C3686d3E724";

  // Mint 10000 SAT tokens (for testing)
  const amount = 10000n;

  console.log(`Minting ${amount} SAT tokens to ${userAddress}...`);

  const tx = await MySecretToken.mint(userAddress, amount);
  await tx.wait();

  console.log("✅ Tokens minted successfully!");
  console.log("Transaction hash:", tx.hash);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
