// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, externalEuint64, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

/**
 * @title 盲拍合约 (改进版 - 统一 Claim 接口)
 * @notice 支持多拍卖、图片拍卖、加密出价的盲拍系统
 * @dev 使用 FHEVM 实现加密出价，保护出价隐私
 *      改进：所有出价者调用统一的 claim() 接口，自动判断获胜/败者并执行相应操作
 */
contract BlindAuction is ZamaEthereumConfig, ReentrancyGuard {
    /// @notice 拍卖结构体，存储所有拍卖数据
    struct Auction {
        address beneficiary;              // 受益人地址
        string metadataCID;               // IPFS CID，指向包含所有元数据的 JSON 文件
        uint256 listingFee;               // 创建拍卖时支付的固定上架费（明文）
        uint256 auctionStartTime;         // 拍卖开始时间
        uint256 auctionEndTime;           // 拍卖结束时间
        euint64 highestBid;               // 最高出价（加密）
        euint64 soldTotal;                // 已售出代币总量（防止平局重复售出）
    }

    /// @notice 平台所有者，接收手续费
    address public owner;

    /// @notice 机密支付代币合约
    IERC7984 public confidentialToken;

    /// @notice 固定上架费（明文，例如 0.01 ETH）
    uint256 public constant LISTING_FEE = 0.01 ether;

    /// @notice 固定成交手续费 / 押金（明文，例如 0.05 ETH）
    uint256 public constant SUCCESS_FEE = 0.05 ether;

    /// @notice 累计的手续费（明文 ETH）
    uint256 private accumulatedFees;

    /// @notice 拍卖 ID 计数器
    uint256 public nextAuctionId;

    /// @notice 拍卖 ID 到拍卖数据的映射
    mapping(uint256 => Auction) public auctions;

    /// @notice 拍卖 ID 到出价者到出价金额的映射
    mapping(uint256 => mapping(address => euint64)) private auctionBids;

    /// @notice 拍卖 ID 到出价者列表的映射
    mapping(uint256 => address[]) private auctionBidders;

    /// @notice 拍卖 ID 到出价者到是否已领取的映射
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    /// @notice 拍卖 ID 到出价者到押金金额的映射
    mapping(uint256 => mapping(address => uint256)) public stakes;

    /// @notice 用户地址到其创建的拍卖 ID 数组的映射
    mapping(address => uint256[]) private userAuctions;

    /// @notice 用户地址到其出价的拍卖 ID 数组的映射
    mapping(address => uint256[]) private userBids;

    // ========== 错误定义 ==========

    /// @notice 函数调用过早时抛出
    /// @param time 可以调用的时间
    error TooEarlyError(uint256 time);

    /// @notice 函数调用过晚时抛出
    /// @param time 不能调用的时间
    error TooLateError(uint256 time);

    /// @notice 拍卖不存在时抛出
    error AuctionNotFound();

    /// @notice 调用者不是所有者时抛出
    error OnlyOwner();

    // ========== 事件定义 ==========

    /// @notice 创建新拍卖时触发
    /// @param auctionId 拍卖 ID
    /// @param beneficiary 受益人地址
    /// @param metadataCID IPFS CID
    /// @param startTime 开始时间
    /// @param endTime 结束时间
    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed beneficiary,
        string metadataCID,
        uint256 startTime,
        uint256 endTime
    );

    /// @notice 出价时触发
    /// @param auctionId 拍卖 ID
    /// @param bidder 出价者地址
    event BidPlaced(uint256 indexed auctionId, address indexed bidder);

    /// @notice 领取时触发（无论获胜还是败者）
    /// @param auctionId 拍卖 ID
    /// @param claimer 领取者地址
    event Claimed(uint256 indexed auctionId, address indexed claimer);

    /// @notice 提取押金时触发
    /// @param auctionId 拍卖 ID
    /// @param claimer 领取者地址
    /// @param amount 押金金额
    event StakeWithdrawn(uint256 indexed auctionId, address indexed claimer, uint256 amount);

    /// @notice 所有者提取手续费时触发
    /// @param owner 所有者地址
    /// @param amount 提取金额
    event FeesWithdrawn(address indexed owner, uint256 amount);

    // ========== 修饰符 ==========

    /// @notice 确保拍卖存在
    modifier auctionExists(uint256 auctionId) {
        if (auctionId >= nextAuctionId) revert AuctionNotFound();
        _;
    }

    /// @notice 确保在拍卖期间调用
    modifier onlyDuringAuction(uint256 auctionId) {
        Auction storage auction = auctions[auctionId];
        if (block.timestamp < auction.auctionStartTime) revert TooEarlyError(auction.auctionStartTime);
        if (block.timestamp >= auction.auctionEndTime) revert TooLateError(auction.auctionEndTime);
        _;
    }

    /// @notice 确保在拍卖结束后调用
    modifier onlyAfterEnd(uint256 auctionId) {
        Auction storage auction = auctions[auctionId];
        if (block.timestamp < auction.auctionEndTime) revert TooEarlyError(auction.auctionEndTime);
        _;
    }

    /// @notice 确保调用者是所有者
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // ========== 构造函数 ==========

    /// @notice 构造函数
    /// @param _confidentialTokenAddress 机密代币合约地址
    constructor(address _confidentialTokenAddress) ZamaEthereumConfig() {
        owner = msg.sender;
        confidentialToken = IERC7984(_confidentialTokenAddress);
        nextAuctionId = 0;
    }

    // ========== 视图函数 ==========

    /// @notice 获取指定拍卖和账户的加密出价
    /// @param auctionId 拍卖 ID
    /// @param account 账户地址
    /// @return encryptedBid 加密的出价金额
    function getEncryptedBid(
        uint256 auctionId,
        address account
    ) external view auctionExists(auctionId) returns (euint64 encryptedBid) {
        return auctionBids[auctionId][account];
    }

    /// @notice 获取拍卖详情
    /// @param auctionId 拍卖 ID
    /// @return beneficiaryAddr 受益人地址
    /// @return metadataCID IPFS CID
    /// @return startTime 开始时间
    /// @return endTime 结束时间
    function getAuction(uint256 auctionId) external view auctionExists(auctionId) returns (
        address beneficiaryAddr,
        string memory metadataCID,
        uint256 startTime,
        uint256 endTime
    ) {
        Auction storage auction = auctions[auctionId];
        return (
            auction.beneficiary,
            auction.metadataCID,
            auction.auctionStartTime,
            auction.auctionEndTime
        );
    }

    /// @notice 获取用户创建的所有拍卖
    /// @param user 用户地址
    /// @return auctionIds 用户创建的拍卖 ID 数组
    function getUserCreatedAuctions(
        address user
    ) external view returns (uint256[] memory auctionIds) {
        return userAuctions[user];
    }

    /// @notice 获取用户出价的所有拍卖
    /// @param user 用户地址
    /// @return auctionIds 用户出价的拍卖 ID 数组
    function getUserBidAuctions(
        address user
    ) external view returns (uint256[] memory auctionIds) {
        return userBids[user];
    }

    /// @notice 获取用户创建的拍卖数量
    /// @param user 用户地址
    /// @return count 用户创建的拍卖数量
    function getUserCreatedAuctionsCount(
        address user
    ) external view returns (uint256 count) {
        return userAuctions[user].length;
    }

    /// @notice 获取用户出价的拍卖数量
    /// @param user 用户地址
    /// @return count 用户出价的拍卖数量
    function getUserBidAuctionsCount(
        address user
    ) external view returns (uint256 count) {
        return userBids[user].length;
    }

    // ========== 拍卖管理 ==========

    /// @notice 创建新拍卖（任何人都可以创建，需支付固定上架费）
    /// @param _metadataCID IPFS CID，指向包含所有元数据的 JSON 文件
    /// @param _auctionStartTime 拍卖开始时间
    /// @param _auctionEndTime 拍卖结束时间
    /// @return auctionId 新创建的拍卖 ID
    function createAuction(
        string calldata _metadataCID,
        uint256 _auctionStartTime,
        uint256 _auctionEndTime
    ) external payable nonReentrant returns (uint256) {
        require(_auctionStartTime < _auctionEndTime, "Invalid time");
        require(_auctionStartTime >= block.timestamp, "Start time cannot be in the past");
        require(bytes(_metadataCID).length > 0, "Metadata CID required");
        require(msg.value >= LISTING_FEE, "Insufficient listing fee");

        // 收取固定上架费
        accumulatedFees += msg.value;

        // 创建新拍卖
        uint256 auctionId = nextAuctionId++;

        Auction storage newAuction = auctions[auctionId];
        newAuction.beneficiary = msg.sender;
        newAuction.metadataCID = _metadataCID;
        newAuction.listingFee = msg.value;
        newAuction.auctionStartTime = _auctionStartTime;
        newAuction.auctionEndTime = _auctionEndTime;
        newAuction.highestBid = FHE.asEuint64(0);
        newAuction.soldTotal = FHE.asEuint64(0);

        FHE.allowThis(newAuction.highestBid);
        FHE.allowThis(newAuction.soldTotal);

        // 将拍卖添加到用户创建的拍卖列表
        userAuctions[msg.sender].push(auctionId);

        emit AuctionCreated(
            auctionId,
            msg.sender,
            _metadataCID,
            _auctionStartTime,
            _auctionEndTime
        );

        return auctionId;
    }

    /// @notice 对指定拍卖出价
    /// @param auctionId 拍卖 ID
    /// @param encryptedAmount 加密的出价金额
    /// @param inputProof 加密金额的证明
    function bid(
        uint256 auctionId,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) public auctionExists(auctionId) onlyDuringAuction(auctionId) nonReentrant {
        // 获取并验证用户出价金额
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);

        // 转移机密代币作为支付
        euint64 balanceBefore = confidentialToken.confidentialBalanceOf(address(this));
        FHE.allowTransient(amount, address(confidentialToken));
        confidentialToken.confidentialTransferFrom(msg.sender, address(this), amount);
        euint64 balanceAfter = confidentialToken.confidentialBalanceOf(address(this));
        euint64 sentBalance = FHE.sub(balanceAfter, balanceBefore);

        // 更新出价余额
        euint64 previousBid = auctionBids[auctionId][msg.sender];

        if (FHE.isInitialized(previousBid)) {
            // 用户增加出价
            euint64 newBid = FHE.add(previousBid, sentBalance);
            auctionBids[auctionId][msg.sender] = newBid;
        } else {
            // 用户首次出价
            auctionBids[auctionId][msg.sender] = sentBalance;
            // 将拍卖添加到用户出价列表
            userBids[msg.sender].push(auctionId);
            // 🔥 将出价者添加到拍卖的出价者列表
            auctionBidders[auctionId].push(msg.sender);
        }

        // 比较用户总出价
        euint64 currentBid = auctionBids[auctionId][msg.sender];
        FHE.allowThis(currentBid);
        FHE.allow(currentBid, msg.sender);

        emit BidPlaced(auctionId, msg.sender);
    }

    /// @notice 统一的领取接口（获胜者和败者都调用此函数）
    /// @dev 通过比较所有出价者的出价来判断是否是获胜者：
    ///      - 获胜者：代币转给卖家
    ///      - 败者：代币退还自己
    ///      - 所有人：押金可通过 withdrawStake 取回（平台仅通过上架费盈利）
    /// @param auctionId 拍卖 ID
    function claim(uint256 auctionId)
        public
        payable
        auctionExists(auctionId)
        onlyAfterEnd(auctionId)
        nonReentrant
    {
        Auction storage auction = auctions[auctionId];
        require(!hasClaimed[auctionId][msg.sender], "Already claimed");
        require(msg.value >= SUCCESS_FEE, "Must stake 0.05 ETH");

        // 获取自己的出价
        euint64 myBid = auctionBids[auctionId][msg.sender];
        require(FHE.isInitialized(myBid), "No bid to claim");
        FHE.allowThis(myBid); // 确保合约有权限读取自己的出价

        // 🔥 判断是否是获胜者：比较所有出价者的出价
        // 使用反向逻辑：如果我的出价低于任何其他出价者，则我是败者
        // 然后：isWinner = NOT isLoser
        address[] memory bidders = auctionBidders[auctionId];
        ebool isLoser = FHE.asEbool(false);

        for (uint256 i = 0; i < bidders.length; i++) {
            if (bidders[i] != msg.sender) {
                euint64 otherBid = auctionBids[auctionId][bidders[i]];
                if (FHE.isInitialized(otherBid)) {
                    FHE.allowThis(otherBid); // 确保合约有权限读取其他出价
                    // 如果我的出价低于别人的，则我是败者
                    ebool myBidIsLower = FHE.lt(myBid, otherBid);
                    isLoser = FHE.or(isLoser, myBidIsLower);
                }
            }
        }

        // 获胜者 = 非败者
        ebool isWinner = FHE.not(isLoser);

        // 🔥 计算转账金额（使用 FHE.select）
        // 如果是获胜者：toSeller = myBid, toSelf = 0
        // 如果是败者：toSeller = 0, toSelf = myBid
        euint64 toSeller = FHE.select(isWinner, myBid, FHE.asEuint64(0));
        euint64 toSelf = FHE.select(isWinner, FHE.asEuint64(0), myBid);

        // 🔥 防止平局导致多次售出：如果已有人转账给卖家，后续人强制退款
        ebool alreadySold = FHE.gt(auction.soldTotal, FHE.asEuint64(0));
        euint64 safeSeller = FHE.select(alreadySold, FHE.asEuint64(0), toSeller);
        euint64 safeSelf = FHE.select(alreadySold, myBid, toSelf);

        // 执行转账
        FHE.allowTransient(safeSeller, address(confidentialToken));
        confidentialToken.confidentialTransfer(auction.beneficiary, safeSeller);

        FHE.allowTransient(safeSelf, address(confidentialToken));
        confidentialToken.confidentialTransfer(msg.sender, safeSelf);

        // 更新已售出总量
        auction.soldTotal = FHE.add(auction.soldTotal, safeSeller);
        FHE.allowThis(auction.soldTotal);

        // 记录状态（不清空出价记录，以便后续领取者能正确比较）
        hasClaimed[auctionId][msg.sender] = true;
        stakes[auctionId][msg.sender] = msg.value; // 所有人押金都可提取

        emit Claimed(auctionId, msg.sender);
    }

    /// @notice 提取押金（所有出价者都可使用）
    /// @dev 平台通过上架费（LISTING_FEE）盈利，押金可全额退还
    /// @param auctionId 拍卖 ID
    function withdrawStake(uint256 auctionId) public nonReentrant {
        require(hasClaimed[auctionId][msg.sender], "Must claim first");

        uint256 stakeAmount = stakes[auctionId][msg.sender];
        require(stakeAmount > 0, "No stake to withdraw");

        // 重置押金
        stakes[auctionId][msg.sender] = 0;

        // 退还押金
        (bool success, ) = payable(msg.sender).call{value: stakeAmount}("");
        require(success, "Stake withdrawal failed");

        emit StakeWithdrawn(auctionId, msg.sender, stakeAmount);
    }

    /// @notice 所有者提取累计手续费（ETH）
    /// @dev 只能由所有者调用，包括上架费和成交手续费
    function withdrawFees() external onlyOwner nonReentrant {
        uint256 amount = accumulatedFees;
        require(amount > 0, "No fees to withdraw");

        // 重置累计手续费
        accumulatedFees = 0;

        // 转账 ETH 给所有者
        (bool success, ) = payable(owner).call{value: amount}("");
        require(success, "Transfer failed");

        emit FeesWithdrawn(owner, amount);
    }
}
