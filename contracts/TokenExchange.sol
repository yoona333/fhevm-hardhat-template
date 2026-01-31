// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./MySecretToken.sol";
import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title TokenExchange
 * @notice 允许用户用 ETH 购买和赎回加密代币
 * @dev 提供简单的 1:1 兑换机制（1 ETH = 10^6 tokens）
 */
contract TokenExchange is ZamaEthereumConfig {
    MySecretToken public token;
    address public owner;

    /// @notice 兑换率：1 ETH = 1,000,000 tokens (6 decimals)
    uint256 public constant EXCHANGE_RATE = 1e6;

    /// @notice 合约 ETH 储备金
    uint256 public ethReserve;

    error OnlyOwner();
    error InsufficientETH();
    error InsufficientReserve();

    event TokensPurchased(address indexed buyer, uint256 ethAmount, uint64 tokenAmount);
    event TokensRedeemed(address indexed seller, uint64 tokenAmount, uint256 ethAmount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(address _tokenAddress) ZamaEthereumConfig() {
        token = MySecretToken(_tokenAddress);
        owner = msg.sender;
    }

    /// @notice 用 ETH 购买加密代币
    /// @dev 1 ETH = 10^6 tokens
    function buyTokens() external payable {
        require(msg.value > 0, "Must send ETH");

        // 计算可购买的代币数量
        uint256 tokenAmount = msg.value * EXCHANGE_RATE / 1 ether;
        require(tokenAmount <= type(uint64).max, "Amount too large");

        // 增加 ETH 储备
        ethReserve += msg.value;

        // 铸造代币给用户
        token.mint(msg.sender, uint64(tokenAmount));

        emit TokensPurchased(msg.sender, msg.value, uint64(tokenAmount));
    }

    /// @notice 赎回代币换回 ETH
    /// @param tokenAmount 要赎回的代币数量
    function redeemTokens(uint64 tokenAmount) external {
        require(tokenAmount > 0, "Amount must be positive");

        // 计算应返还的 ETH
        uint256 ethAmount = (uint256(tokenAmount) * 1 ether) / EXCHANGE_RATE;
        require(ethAmount <= ethReserve, "Insufficient reserve");

        // 减少 ETH 储备
        ethReserve -= ethAmount;

        // 从用户销毁代币（需要先转移到合约）
        // 注意：这需要用户先授权
        euint64 amount = FHE.asEuint64(tokenAmount);
        FHE.allowTransient(amount, address(token));
        token.confidentialTransferFrom(msg.sender, address(this), amount);

        // 返还 ETH
        (bool success, ) = payable(msg.sender).call{value: ethAmount}("");
        require(success, "ETH transfer failed");

        emit TokensRedeemed(msg.sender, tokenAmount, ethAmount);
    }

    /// @notice Owner 添加 ETH 储备金
    function addReserve() external payable onlyOwner {
        ethReserve += msg.value;
    }

    /// @notice Owner 提取多余的 ETH
    function withdrawReserve(uint256 amount) external onlyOwner {
        require(amount <= ethReserve, "Insufficient reserve");
        ethReserve -= amount;

        (bool success, ) = payable(owner).call{value: amount}("");
        require(success, "Transfer failed");
    }

    /// @notice 获取当前兑换率
    function getExchangeRate() external pure returns (uint256) {
        return EXCHANGE_RATE;
    }

    /// @notice 计算可购买的代币数量
    function calculateTokenAmount(uint256 ethAmount) external pure returns (uint256) {
        return ethAmount * EXCHANGE_RATE / 1 ether;
    }

    /// @notice 计算赎回所需的 ETH
    function calculateEthAmount(uint64 tokenAmount) external pure returns (uint256) {
        return (uint256(tokenAmount) * 1 ether) / EXCHANGE_RATE;
    }
}
