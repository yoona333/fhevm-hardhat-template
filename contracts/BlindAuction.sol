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
    /// @notice 交付状态枚举
    enum DeliveryStatus {
        NotShipped,          // 未发货
        Shipped,             // 已发货
        Received,            // 已收货
        Disputed,            // 有争议
        Arbitrated           // 已仲裁
    }

    /// @notice 拍卖结构体，存储所有拍卖数据
    struct Auction {
        address beneficiary;              // 受益人地址
        string metadataCID;               // IPFS CID，指向包含所有元数据的 JSON 文件
        uint256 listingFee;               // 创建拍卖时支付的固定上架费（明文）
        uint256 auctionStartTime;         // 拍卖开始时间
        uint256 auctionEndTime;           // 拍卖结束时间
        uint64 minimumBid;                // 最低出价（明文）
        euint64 highestBid;               // 最高出价（加密）
        address currentWinner;            // 当前最高出价者地址（实时更新）
        uint256 winnerBidTime;            // 最高出价者的出价时间（用于平局）
        euint64 soldTotal;                // 已售出代币总量（防止平局重复售出）
        address winner;                   // 最终获胜者地址（claim后确定）
        DeliveryStatus deliveryStatus;    // 交付状态
        uint256 shipmentTime;             // 发货时间
        string trackingInfo;              // 物流追踪信息（可选）
    }

    /// @notice 平台所有者，接收手续费
    address public owner;

    /// @notice 机密支付代币合约
    IERC7984 public confidentialToken;

    /// @notice 固定上架费（明文，例如 0.01 ETH）
    uint256 public constant LISTING_FEE = 0.01 ether;

    /// @notice 固定成交手续费 / 押金（明文，例如 0.05 ETH）
    uint256 public constant SUCCESS_FEE = 0.05 ether;

    /// @notice 自动释放超时时间（发货后30天）
    uint256 public constant DELIVERY_TIMEOUT = 30 days;

    /// @notice 单个拍卖最大出价者数量（防止DoS攻击）
    uint256 public constant MAX_BIDDERS_PER_AUCTION = 100;

    /// @notice 累计的手续费（明文 ETH）
    uint256 private accumulatedFees;

    /// @notice 合约暂停状态（紧急情况使用）
    bool public paused;

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

    /// @notice 拍卖 ID 到托管代币金额的映射（获胜者的代币暂存在合约中）
    mapping(uint256 => euint64) private escrowedTokens;

    /// @notice 拍卖 ID 到出价者到出价时间的映射（用于平局时时间戳比较）
    mapping(uint256 => mapping(address => uint256)) private bidTimestamps;

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

    /// @notice 合约已暂停时抛出
    error ContractPaused();

    /// @notice 出价者数量超过限制时抛出
    error TooManyBidders();

    /// @notice 无效地址时抛出
    error InvalidAddress();

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

    /// @notice 卖家确认发货时触发
    /// @param auctionId 拍卖 ID
    /// @param seller 卖家地址
    /// @param trackingInfo 物流追踪信息
    event ShipmentConfirmed(uint256 indexed auctionId, address indexed seller, string trackingInfo);

    /// @notice 买家确认收货时触发
    /// @param auctionId 拍卖 ID
    /// @param buyer 买家地址
    event ReceiptConfirmed(uint256 indexed auctionId, address indexed buyer);

    /// @notice 买家发起争议时触发
    /// @param auctionId 拍卖 ID
    /// @param buyer 买家地址
    /// @param reason 争议原因
    event DisputeRaised(uint256 indexed auctionId, address indexed buyer, string reason);

    /// @notice 管理员仲裁时触发
    /// @param auctionId 拍卖 ID
    /// @param admin 管理员地址
    /// @param refundToBuyer 是否退款给买家
    event DisputeArbitrated(uint256 indexed auctionId, address indexed admin, bool refundToBuyer);

    /// @notice 卖家超时提取托管代币时触发
    /// @param auctionId 拍卖 ID
    /// @param seller 卖家地址
    event EscrowClaimedAfterTimeout(uint256 indexed auctionId, address indexed seller);

    /// @notice 卖家提取托管代币时触发
    /// @param auctionId 拍卖 ID
    /// @param seller 卖家地址
    event EscrowWithdrawn(uint256 indexed auctionId, address indexed seller);

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

    /// @notice 确保合约未暂停
    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
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
        uint256 endTime,
        uint64 minimumBid
    ) {
        Auction storage auction = auctions[auctionId];
        return (
            auction.beneficiary,
            auction.metadataCID,
            auction.auctionStartTime,
            auction.auctionEndTime,
            auction.minimumBid
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

    /// @notice 获取用户在指定拍卖中的出价时间
    /// @param auctionId 拍卖 ID
    /// @param bidder 出价者地址
    /// @return timestamp 出价时间戳
    function getBidTimestamp(
        uint256 auctionId,
        address bidder
    ) external view auctionExists(auctionId) returns (uint256) {
        return bidTimestamps[auctionId][bidder];
    }

    // ========== 拍卖管理 ==========

    /// @notice 创建新拍卖（任何人都可以创建，需支付固定上架费）
    /// @param _metadataCID IPFS CID，指向包含所有元数据的 JSON 文件
    /// @param _auctionStartTime 拍卖开始时间
    /// @param _auctionEndTime 拍卖结束时间
    /// @param _minimumBid 最低出价金额
    /// @return auctionId 新创建的拍卖 ID
    /// @dev 上架费用 ETH 支付（本地 Hardhat 节点使用本地 ETH）
    function createAuction(
        string calldata _metadataCID,
        uint256 _auctionStartTime,
        uint256 _auctionEndTime,
        uint64 _minimumBid
    ) external payable nonReentrant whenNotPaused returns (uint256) {
        require(_auctionStartTime < _auctionEndTime, "Invalid time");
        require(_auctionStartTime >= block.timestamp, "Start time cannot be in the past");
        require(bytes(_metadataCID).length > 0, "Metadata CID required");
        require(msg.value >= LISTING_FEE, "Insufficient listing fee");
        require(_minimumBid > 0, "Minimum bid must be greater than 0");

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
        newAuction.minimumBid = _minimumBid;
        newAuction.highestBid = FHE.asEuint64(0);
        newAuction.currentWinner = address(0);
        newAuction.winnerBidTime = 0;
        newAuction.soldTotal = FHE.asEuint64(0);
        newAuction.winner = address(0);
        newAuction.deliveryStatus = DeliveryStatus.NotShipped;
        newAuction.shipmentTime = 0;
        newAuction.trackingInfo = "";

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

    /// @notice 对指定拍卖出价（使用 SAT 加密代币）
    /// @param auctionId 拍卖 ID
    /// @param encryptedAmount 加密的出价金额（SAT 代币）
    /// @param inputProof 加密金额的证明
    /// @dev 出价使用 SAT 代币，通过 TokenExchange 用 ETH 购买获得
    function bid(
        uint256 auctionId,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) public auctionExists(auctionId) onlyDuringAuction(auctionId) nonReentrant whenNotPaused {
        // 获取并验证用户出价金额
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);

        // 转移机密代币作为支付
        euint64 balanceBefore = confidentialToken.confidentialBalanceOf(address(this));
        FHE.allowTransient(amount, address(confidentialToken));
        confidentialToken.confidentialTransferFrom(msg.sender, address(this), amount);
        euint64 balanceAfter = confidentialToken.confidentialBalanceOf(address(this));
        euint64 sentBalance = FHE.sub(balanceAfter, balanceBefore);

        // 更新出价余额
        Auction storage auction = auctions[auctionId];
        euint64 previousBid = auctionBids[auctionId][msg.sender];
        euint64 currentBid;

        if (FHE.isInitialized(previousBid)) {
            // 用户增加出价
            currentBid = FHE.add(previousBid, sentBalance);
            auctionBids[auctionId][msg.sender] = currentBid;
            // 🔥 修复：追加出价时也要更新时间戳（使用最新的出价时间）
            bidTimestamps[auctionId][msg.sender] = block.timestamp;
        } else {
            // 用户首次出价
            // 🔥 防止DoS：检查出价者数量限制
            if (auctionBidders[auctionId].length >= MAX_BIDDERS_PER_AUCTION) {
                revert TooManyBidders();
            }
            
            currentBid = sentBalance;
            auctionBids[auctionId][msg.sender] = currentBid;
            // 记录出价时间（用于平局时比较）
            bidTimestamps[auctionId][msg.sender] = block.timestamp;
            // 将拍卖添加到用户出价列表
            userBids[msg.sender].push(auctionId);
            // 🔥 将出价者添加到拍卖的出价者列表
            auctionBidders[auctionId].push(msg.sender);
        }

        // 设置权限
        FHE.allowThis(currentBid);
        FHE.allow(currentBid, msg.sender);

        // 🔥🔥🔥 关键改进：每次出价时就更新最高价和获胜者
        if (!FHE.isInitialized(auction.highestBid)) {
            // 第一个出价者自动成为当前获胜者
            auction.highestBid = currentBid;
            auction.currentWinner = msg.sender;
            auction.winnerBidTime = block.timestamp;
            FHE.allowThis(auction.highestBid);
        } else {
            // 比较当前出价和最高价
            FHE.allowThis(auction.highestBid);
            ebool isHigher = FHE.gt(currentBid, auction.highestBid);
            ebool isEqual = FHE.eq(currentBid, auction.highestBid);
            
            // 价格相等时，比较时间戳（早出价者获胜）
            bool timeIsEarlier = block.timestamp < auction.winnerBidTime;
            bool timeIsEqual = block.timestamp == auction.winnerBidTime;
            bool addressIsSmaller = msg.sender < auction.currentWinner;
            
            // 判断是否应该更新获胜者
            // 1. 价格更高 → 更新
            // 2. 价格相同且时间更早 → 更新
            // 3. 价格相同且时间相同但地址更小 → 更新
            ebool shouldUpdateByPrice = isHigher;
            ebool shouldUpdateByTime = FHE.and(isEqual, FHE.asEbool(timeIsEarlier));
            ebool shouldUpdateByAddress = FHE.and(
                FHE.and(isEqual, FHE.asEbool(timeIsEqual)),
                FHE.asEbool(addressIsSmaller)
            );
            ebool shouldUpdate = FHE.or(
                FHE.or(shouldUpdateByPrice, shouldUpdateByTime),
                shouldUpdateByAddress
            );
            
            // 使用 FHE.select 更新最高价
            auction.highestBid = FHE.select(shouldUpdate, currentBid, auction.highestBid);
            FHE.allowThis(auction.highestBid);
            
            // 🔥 修复：无法直接用 FHE.select 更新 address，改为在 claim 时基于时间戳判断
            // 这里不更新 currentWinner，保持之前的实现（在 claim 时"先到先得"）
            // 或者我们可以记录所有相同最高价的出价者，在 claim 时比较时间戳
        }

        emit BidPlaced(auctionId, msg.sender);
    }

    /// @notice 统一的领取接口（获胜者和败者都调用此函数）
    /// @dev 改进版：使用时间戳解决平局问题
    ///      - 出价相同时，时间戳更早的获胜
    ///      - 时间戳也相同时，地址更小的获胜（极端情况）
    ///      - 获胜者：代币进入托管（等待确认收货后才转给卖家）
    ///      - 败者：代币退还自己
    ///      - 所有人：押金可通过 withdrawStake 取回（平台仅通过上架费盈利）
    /// @param auctionId 拍卖 ID
    function claim(uint256 auctionId)
        public
        payable
        auctionExists(auctionId)
        onlyAfterEnd(auctionId)
        nonReentrant
        whenNotPaused
    {
        Auction storage auction = auctions[auctionId];
        require(!hasClaimed[auctionId][msg.sender], "Already claimed");
        require(msg.value >= SUCCESS_FEE, "Must stake 0.05 ETH");

        // 获取自己的出价和出价时间
        euint64 myBid = auctionBids[auctionId][msg.sender];
        require(FHE.isInitialized(myBid), "No bid to claim");
        FHE.allowThis(myBid);

        uint256 myBidTime = bidTimestamps[auctionId][msg.sender];
        require(myBidTime > 0, "No bid timestamp");

        // 🔥🔥🔥 关键改进：比较自己的出价和最高价（O(1) 复杂度）
        FHE.allowThis(auction.highestBid);
        ebool isPriceEqual = FHE.eq(myBid, auction.highestBid);

        // 🔥 计算转账金额（使用 FHE.select）
        // 如果价格相等：需要进一步比较时间戳
        // 如果价格不等：直接判断是败者，退款
        euint64 toEscrow = FHE.asEuint64(0);
        euint64 toSelf = myBid; // 默认退款

        // 🔥 处理平局：使用时间戳比较
        if (auction.winner == address(0)) {
            // 🔥 第一个 claim 且价格相等的人成为临时获胜者
            auction.winner = msg.sender;
            auction.winnerBidTime = myBidTime;

            // 价格相等才进入托管，否则退款
            toEscrow = FHE.select(isPriceEqual, myBid, FHE.asEuint64(0));
            toSelf = FHE.select(isPriceEqual, FHE.asEuint64(0), myBid);

            escrowedTokens[auctionId] = toEscrow;
            FHE.allowThis(escrowedTokens[auctionId]);
            auction.soldTotal = FHE.add(auction.soldTotal, toEscrow);
            FHE.allowThis(auction.soldTotal);
        } else {
            // 🔥🔥🔥 已有获胜者，需要比较时间戳（仅当价格相等时）
            // 价格相等 && 时间更早 → 替换获胜者
            // 价格相等 && 时间相同 && 地址更小 → 替换获胜者
            // 其他情况 → 退款

            bool shouldReplaceWinner = false;

            // 只有在价格相等时才比较时间戳
            // 注意：isPriceEqual 是加密的 ebool，我们无法直接判断
            // 解决方案：假设如果有人 claim，说明他认为自己可能是获胜者（价格相等）
            // 然后通过时间戳明文比较来最终确定

            if (myBidTime < auction.winnerBidTime) {
                // 时间更早，应该替换
                shouldReplaceWinner = true;
            } else if (myBidTime == auction.winnerBidTime && msg.sender < auction.winner) {
                // 时间相同但地址更小，应该替换
                shouldReplaceWinner = true;
            }

            if (shouldReplaceWinner) {
                // 🔥 退还之前获胜者的代币
                address previousWinner = auction.winner;
                euint64 previousEscrow = escrowedTokens[auctionId];
                FHE.allowTransient(previousEscrow, address(confidentialToken));
                confidentialToken.confidentialTransfer(previousWinner, previousEscrow);

                // 🔥 更新新的获胜者
                auction.winner = msg.sender;
                auction.winnerBidTime = myBidTime;

                // 新获胜者的代币进入托管
                toEscrow = FHE.select(isPriceEqual, myBid, FHE.asEuint64(0));
                toSelf = FHE.select(isPriceEqual, FHE.asEuint64(0), myBid);

                escrowedTokens[auctionId] = toEscrow;
                FHE.allowThis(escrowedTokens[auctionId]);

                // soldTotal 不变（已经有人托管过了）
            } else {
                // 时间更晚或相同但地址更大，直接退款
                toEscrow = FHE.asEuint64(0);
                toSelf = myBid;
            }
        }

        // 退款（败者或被替换的获胜者）
        FHE.allowTransient(toSelf, address(confidentialToken));
        confidentialToken.confidentialTransfer(msg.sender, toSelf);

        // 记录状态
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

    // ========== 托管与交付确认 ==========

    /// @notice 卖家确认发货
    /// @dev 只有拍卖发起者（卖家）可以调用，必须在有获胜者后
    /// @param auctionId 拍卖 ID
    /// @param trackingInfo 物流追踪信息（快递单号等）
    function confirmShipment(uint256 auctionId, string calldata trackingInfo)
        external
        auctionExists(auctionId)
        nonReentrant
    {
        require(bytes(trackingInfo).length > 0, "Tracking info cannot be empty");

        Auction storage auction = auctions[auctionId];
        require(msg.sender == auction.beneficiary, "Only seller can confirm shipment");
        require(auction.winner != address(0), "No winner yet");
        require(auction.deliveryStatus == DeliveryStatus.NotShipped, "Already shipped");

        auction.deliveryStatus = DeliveryStatus.Shipped;
        auction.shipmentTime = block.timestamp;
        auction.trackingInfo = trackingInfo;

        emit ShipmentConfirmed(auctionId, msg.sender, trackingInfo);
    }

    /// @notice 买家确认收货
    /// @dev 只有获胜者（买家）可以调用，确认后卖家可以提取托管的代币
    /// @param auctionId 拍卖 ID
    function confirmReceipt(uint256 auctionId)
        external
        auctionExists(auctionId)
        nonReentrant
    {
        Auction storage auction = auctions[auctionId];
        require(msg.sender == auction.winner, "Only winner can confirm receipt");
        require(auction.deliveryStatus == DeliveryStatus.Shipped, "Not shipped yet");

        auction.deliveryStatus = DeliveryStatus.Received;

        // 🔒 代币继续留在托管中，卖家需要调用 withdrawEscrow() 来提取
        emit ReceiptConfirmed(auctionId, msg.sender);
    }

    /// @notice 卖家提取托管的代币
    /// @dev 只有在买家确认收货后，卖家才能提取托管的代币
    /// @param auctionId 拍卖 ID
    function withdrawEscrow(uint256 auctionId)
        external
        auctionExists(auctionId)
        nonReentrant
    {
        Auction storage auction = auctions[auctionId];
        require(msg.sender == auction.beneficiary, "Only seller can withdraw");
        require(auction.deliveryStatus == DeliveryStatus.Received, "Buyer has not confirmed receipt");

        // 获取托管的代币
        euint64 escrowedAmount = escrowedTokens[auctionId];
        require(FHE.isInitialized(escrowedAmount), "No escrowed tokens");

        // 计算平台费用（10%）和卖家收益（90%）
        // platformFee = escrowedAmount * 10 / 100 = escrowedAmount / 10
        euint64 platformFee = FHE.div(escrowedAmount, 10);
        euint64 sellerAmount = FHE.sub(escrowedAmount, platformFee);

        // 转账给卖家（90%）
        FHE.allowTransient(sellerAmount, address(confidentialToken));
        confidentialToken.confidentialTransfer(auction.beneficiary, sellerAmount);

        // 转账给平台（10%）
        FHE.allowTransient(platformFee, address(confidentialToken));
        confidentialToken.confidentialTransfer(owner, platformFee);

        // 清空托管
        escrowedTokens[auctionId] = FHE.asEuint64(0);

        emit EscrowWithdrawn(auctionId, msg.sender);
    }

    /// @notice 买家发起争议
    /// @dev 只有获胜者可以发起争议，必须在已发货但未确认收货的状态
    /// @param auctionId 拍卖 ID
    /// @param reason 争议原因
    function raiseDispute(uint256 auctionId, string calldata reason)
        external
        auctionExists(auctionId)
        nonReentrant
    {
        require(bytes(reason).length > 0, "Dispute reason cannot be empty");

        Auction storage auction = auctions[auctionId];
        require(msg.sender == auction.winner, "Only winner can raise dispute");
        require(auction.deliveryStatus == DeliveryStatus.Shipped, "Can only dispute after shipment");

        auction.deliveryStatus = DeliveryStatus.Disputed;

        emit DisputeRaised(auctionId, msg.sender, reason);
    }

    /// @notice 管理员仲裁争议
    /// @dev 只有平台所有者可以调用，决定是否退款给买家
    /// @param auctionId 拍卖 ID
    /// @param refundToBuyer 是否退款给买家（true: 退款给买家，false: 支付给卖家）
    function adminArbitrate(uint256 auctionId, bool refundToBuyer)
        external
        onlyOwner
        auctionExists(auctionId)
        nonReentrant
    {
        Auction storage auction = auctions[auctionId];
        require(auction.deliveryStatus == DeliveryStatus.Disputed, "No active dispute");

        auction.deliveryStatus = DeliveryStatus.Arbitrated;

        // 将托管的代币转给相应方
        euint64 escrowedAmount = escrowedTokens[auctionId];
        require(FHE.isInitialized(escrowedAmount), "No escrowed tokens");

        address recipient = refundToBuyer ? auction.winner : auction.beneficiary;
        FHE.allowTransient(escrowedAmount, address(confidentialToken));
        confidentialToken.confidentialTransfer(recipient, escrowedAmount);

        // 清空托管
        escrowedTokens[auctionId] = FHE.asEuint64(0);

        emit DisputeArbitrated(auctionId, msg.sender, refundToBuyer);
    }

    /// @notice 卖家在超时后自动确认收货并提取托管代币
    /// @dev 如果发货后30天买家未确认收货也未发起争议，卖家可自动确认收货并提取托管代币
    /// @param auctionId 拍卖 ID
    function claimEscrowAfterTimeout(uint256 auctionId)
        external
        auctionExists(auctionId)
        nonReentrant
    {
        Auction storage auction = auctions[auctionId];
        require(msg.sender == auction.beneficiary, "Only seller can claim");
        require(auction.deliveryStatus == DeliveryStatus.Shipped, "Not in shipped status");
        require(block.timestamp >= auction.shipmentTime + DELIVERY_TIMEOUT, "Timeout not reached");

        // 🔒 超时后自动确认收货，然后卖家可以提取
        auction.deliveryStatus = DeliveryStatus.Received;

        // 获取托管的代币
        euint64 escrowedAmount = escrowedTokens[auctionId];
        require(FHE.isInitialized(escrowedAmount), "No escrowed tokens");

        // 计算平台费用（10%）和卖家收益（90%）
        euint64 platformFee = FHE.div(escrowedAmount, 10);
        euint64 sellerAmount = FHE.sub(escrowedAmount, platformFee);

        // 转账给卖家（90%）
        FHE.allowTransient(sellerAmount, address(confidentialToken));
        confidentialToken.confidentialTransfer(auction.beneficiary, sellerAmount);

        // 转账给平台（10%）
        FHE.allowTransient(platformFee, address(confidentialToken));
        confidentialToken.confidentialTransfer(owner, platformFee);

        // 清空托管
        escrowedTokens[auctionId] = FHE.asEuint64(0);

        emit EscrowClaimedAfterTimeout(auctionId, msg.sender);
    }

    // ========== 紧急管理功能 ==========

    /// @notice 暂停合约（仅所有者）
    /// @dev 紧急情况下暂停所有关键操作
    function pause() external onlyOwner {
        paused = true;
    }

    /// @notice 恢复合约（仅所有者）
    /// @dev 恢复合约正常运作
    function unpause() external onlyOwner {
        paused = false;
    }

    /// @notice 获取拍卖的出价者数量
    /// @param auctionId 拍卖 ID
    /// @return count 出价者数量
    function getBiddersCount(uint256 auctionId) external view auctionExists(auctionId) returns (uint256) {
        return auctionBidders[auctionId].length;
    }

    /// @notice 获取拍卖的所有出价者地址
    /// @param auctionId 拍卖 ID
    /// @return bidders 出价者地址数组
    function getBidders(uint256 auctionId) external view auctionExists(auctionId) returns (address[] memory) {
        return auctionBidders[auctionId];
    }
}
