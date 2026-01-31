/**
 * BlindAuction 合约地址和配置
 * Sepolia 测试网
 */

export const NETWORK = {
  chainId: 11155111,
  chainIdHex: "0xaa36a7",
  name: "Sepolia",
  rpcUrl: "https://sepolia.infura.io/v3/YOUR_INFURA_KEY",
  explorerUrl: "https://sepolia.etherscan.io",
  fhevmGateway: "https://gateway.sepolia.zama.ai",
};

export const CONTRACTS = {
  MySecretToken: "0x168ecd6465D5f6A479ef1cF7bc7B23748eD6e0c7",
  TokenExchange: "0x420d4172D8153cB3fB76b21Ffd0b482F62112f7C",
  BlindAuction: "0xb77038085AA13334C57278CD66dD10Ac7F4171b9",
};

export const OWNER_ADDRESS = "0xc7b0D4dc5184b95Dda276b475dF59C3686d3E724";

export const FEES = {
  LISTING_FEE: "0.01", // ETH
  SUCCESS_FEE: "0.05", // ETH (押金，可退还)
};

export const EXCHANGE_RATE = {
  ethToToken: 1000000, // 1 ETH = 1,000,000 SAT
  tokenDecimals: 6,
};

// Etherscan 链接
export const EXPLORER_LINKS = {
  token: `${NETWORK.explorerUrl}/address/${CONTRACTS.MySecretToken}#code`,
  exchange: `${NETWORK.explorerUrl}/address/${CONTRACTS.TokenExchange}#code`,
  auction: `${NETWORK.explorerUrl}/address/${CONTRACTS.BlindAuction}#code`,
};

// 获取交易链接
export function getTxLink(txHash: string): string {
  return `${NETWORK.explorerUrl}/tx/${txHash}`;
}

// 获取地址链接
export function getAddressLink(address: string): string {
  return `${NETWORK.explorerUrl}/address/${address}`;
}
