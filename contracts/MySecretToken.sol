// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {FHE} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract MySecretToken is ERC7984, ZamaEthereumConfig {
    address public owner;

    error OnlyOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        string memory tokenURI_
    ) ERC7984(name_, symbol_, tokenURI_) ZamaEthereumConfig() {
        owner = msg.sender;
    }

    function mint(address to, uint64 amount) public onlyOwner {
        _mint(to, FHE.asEuint64(amount));
    }

    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }
}
