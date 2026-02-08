// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {FHE} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract MySecretToken is ERC7984, ZamaEthereumConfig {
    address public owner;
    address public minter;  // 添加 minter 角色，用于测试时批量铸造

    error OnlyOwner();
    error OnlyOwnerOrMinter();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyOwnerOrMinter() {
        if (msg.sender != owner && msg.sender != minter) revert OnlyOwnerOrMinter();
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        string memory tokenURI_
    ) ERC7984(name_, symbol_, tokenURI_) ZamaEthereumConfig() {
        owner = msg.sender;
    }

    function mint(address to, uint64 amount) public onlyOwnerOrMinter {
        _mint(to, FHE.asEuint64(amount));
    }

    /// @notice 批量铸造代币（仅用于测试）
    /// @param recipients 接收者地址数组
    /// @param amount 每人铸造的数量
    function mintBatch(address[] calldata recipients, uint64 amount) public onlyOwnerOrMinter {
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], FHE.asEuint64(amount));
        }
    }

    /// @notice 设置 minter 地址（仅用于测试）
    /// @param _minter minter 地址
    function setMinter(address _minter) public onlyOwner {
        minter = _minter;
    }

    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }
}
