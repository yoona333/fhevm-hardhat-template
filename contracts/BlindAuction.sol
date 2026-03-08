// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, externalEuint64, euint64, ebool, eaddress} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/**
 * @title NFT 盲拍合约
 *
 * 流程：
 *   1. createAuction() — 卖家创建拍卖，铸造 NFT，支付上架费
 *   2. bid()           — 买家出价，2% 手续费直接给 owner，98% 存入合约作为竞拍金
 *                        每次出价后实时更新加密 winner（严格大于才替换）
 *   3. requestWinnerDecryption() — 拍卖结束后，标记 encryptedWinner 可公开解密
 *   4. resolveWinner()          — 提交 KMS 解密证明（checkSignatures 验证），写入明文 winner
 *   4. withdraw()      — 非 winner 取回自己的 98% 竞拍金
 *   5. claimNFT()      — winner 领取 NFT，合约将其 98% 竞拍金转给卖家
 */
contract BlindAuction is ERC721URIStorage, ERC721Enumerable, IERC721Receiver, ZamaEthereumConfig, ReentrancyGuard {

    struct Auction {
        address beneficiary;
        string  metadataCID;
        uint256 nftTokenId;
        bool    nftClaimed;
        uint256 auctionStartTime;
        uint256 auctionEndTime;
        uint64  minimumBid;
    }

    address  public owner;
    IERC7984 public confidentialToken;

    uint256 public constant LISTING_FEE             = 0.01 ether;
    uint256 public constant MAX_BIDDERS_PER_AUCTION = 100;

    // 出价手续费比例（分母为 100，例如 2 = 2%），部署时设定
    uint256 public bidFeePercent;

    bool    public  paused;
    uint256 public  nextAuctionId;

    mapping(uint256 => Auction) public auctions;

    // 每个出价者存入合约的加密竞拍金（扣除手续费后的 98%）
    mapping(uint256 => mapping(address => euint64)) private auctionBids;
    mapping(uint256 => address[])                   private auctionBidders;
    // 标记是否已取回竞拍金
    mapping(uint256 => mapping(address => bool))    public  hasWithdrawn;

    // bid 阶段实时维护：加密的当前最高出价 & 加密的 winner 地址
    mapping(uint256 => euint64)  private winnerBid;
    mapping(uint256 => eaddress) private encryptedWinner;

    // resolveWinner 写入：明文 winner 地址
    mapping(uint256 => address) public auctionWinner;

    // 用户维度索引
    mapping(address => uint256[]) private userAuctions;
    mapping(address => uint256[]) private userBids;

    // ─── 错误 ────────────────────────────────────────────────────────────────

    error TooEarlyError(uint256 time);
    error TooLateError(uint256 time);
    error AuctionNotFound();
    error OnlyOwner();
    error ContractPaused();
    error TooManyBidders();

    // ─── 事件 ────────────────────────────────────────────────────────────────

    event AuctionCreated(uint256 indexed auctionId, address indexed beneficiary, string metadataCID, uint256 startTime, uint256 endTime);
    event BidPlaced(uint256 indexed auctionId, address indexed bidder);
    event WinnerResolved(uint256 indexed auctionId, address indexed winner);
    event BidWithdrawn(uint256 indexed auctionId, address indexed bidder);
    event NFTClaimed(uint256 indexed auctionId, address indexed winner, uint256 tokenId);

    // ─── 修饰符 ───────────────────────────────────────────────────────────────

    modifier auctionExists(uint256 auctionId) {
        if (auctionId >= nextAuctionId) revert AuctionNotFound();
        _;
    }

    modifier onlyDuringAuction(uint256 auctionId) {
        Auction storage a = auctions[auctionId];
        if (block.timestamp < a.auctionStartTime) revert TooEarlyError(a.auctionStartTime);
        if (block.timestamp >= a.auctionEndTime)  revert TooLateError(a.auctionEndTime);
        _;
    }

    modifier onlyAfterEnd(uint256 auctionId) {
        if (block.timestamp < auctions[auctionId].auctionEndTime)
            revert TooEarlyError(auctions[auctionId].auctionEndTime);
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    // ─── 构造函数 ─────────────────────────────────────────────────────────────

    constructor(
        address _confidentialTokenAddress,
        string memory _name,
        string memory _symbol,
        uint256 _bidFeePercent
    ) ERC721(_name, _symbol) ZamaEthereumConfig() {
        require(_bidFeePercent <= 100, "Fee percent must be <= 100");
        owner = msg.sender;
        confidentialToken = IERC7984(_confidentialTokenAddress);
        bidFeePercent = _bidFeePercent;
    }

    // ─── ERC721 重写 ──────────────────────────────────────────────────────────

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721URIStorage, ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override(ERC721, ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    // ─── 视图函数 ─────────────────────────────────────────────────────────────

    function getAuction(uint256 auctionId) external view auctionExists(auctionId) returns (
        address beneficiaryAddr, string memory metadataCID, uint256 nftTokenId,
        bool nftClaimed, uint256 startTime, uint256 endTime, uint64 minimumBid
    ) {
        Auction storage a = auctions[auctionId];
        return (a.beneficiary, a.metadataCID, a.nftTokenId, a.nftClaimed, a.auctionStartTime, a.auctionEndTime, a.minimumBid);
    }

    function getEncryptedBid(uint256 auctionId, address account) external view auctionExists(auctionId) returns (euint64) {
        return auctionBids[auctionId][account];
    }

    function getEncryptedWinner(uint256 auctionId) external view auctionExists(auctionId) returns (eaddress) {
        return encryptedWinner[auctionId];
    }

    function getBiddersCount(uint256 auctionId) external view auctionExists(auctionId) returns (uint256) {
        return auctionBidders[auctionId].length;
    }

    function getBidders(uint256 auctionId) external view auctionExists(auctionId) returns (address[] memory) {
        return auctionBidders[auctionId];
    }

    function getUserCreatedAuctions(address user) external view returns (uint256[] memory) { return userAuctions[user]; }
    function getUserBidAuctions(address user)     external view returns (uint256[] memory) { return userBids[user]; }

    // ─── 创建拍卖 ─────────────────────────────────────────────────────────────

    function createAuction(
        string calldata _metadataCID,
        uint256 _auctionStartTime,
        uint256 _auctionEndTime,
        uint64  _minimumBid
    ) external payable nonReentrant whenNotPaused returns (uint256) {
        require(_auctionStartTime < _auctionEndTime,  "Invalid time range");
        require(_auctionStartTime >= block.timestamp, "Start time in the past");
        require(bytes(_metadataCID).length > 0,       "Metadata CID required");
        require(msg.value >= LISTING_FEE,             "Insufficient listing fee");
        require(_minimumBid > 0,                      "Minimum bid must be > 0");

        // 上架费直接给 owner
        (bool ok, ) = payable(owner).call{value: msg.value}("");
        require(ok, "Fee transfer failed");

        uint256 auctionId = nextAuctionId++;
        uint256 tokenId   = auctionId;

        _safeMint(address(this), tokenId);
        _setTokenURI(tokenId, string(abi.encodePacked("ipfs://", _metadataCID)));

        Auction storage a  = auctions[auctionId];
        a.beneficiary      = msg.sender;
        a.metadataCID      = _metadataCID;
        a.nftTokenId       = tokenId;
        a.nftClaimed       = false;
        a.auctionStartTime = _auctionStartTime;
        a.auctionEndTime   = _auctionEndTime;
        a.minimumBid       = _minimumBid;

        userAuctions[msg.sender].push(auctionId);

        emit AuctionCreated(auctionId, msg.sender, _metadataCID, _auctionStartTime, _auctionEndTime);
        return auctionId;
    }

    // ─── 出价 ─────────────────────────────────────────────────────────────────

    /**
     * @notice 出价
     * @dev 出价金额的 2% 作为手续费直接转给 owner，剩余 98% 存入合约作为竞拍金。
     *      每次出价后与当前 winnerBid 比较，严格大于则替换 winner。
     */
    function bid(
        uint256 auctionId,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) public auctionExists(auctionId) onlyDuringAuction(auctionId) nonReentrant whenNotPaused {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);

        // 计算手续费和实际竞拍金
        euint64 fee       = FHE.div(FHE.mul(amount, uint64(bidFeePercent)), 100);
        euint64 bidAmount = FHE.sub(amount, fee);

        // 2% 手续费转给 owner
        FHE.allowTransient(fee, address(confidentialToken));
        confidentialToken.confidentialTransferFrom(msg.sender, owner, fee);

        // 98% 竞拍金转入合约
        FHE.allowTransient(bidAmount, address(confidentialToken));
        confidentialToken.confidentialTransferFrom(msg.sender, address(this), bidAmount);

        // 累加个人竞拍金
        euint64 prevBid = auctionBids[auctionId][msg.sender];
        euint64 myBid;
        if (FHE.isInitialized(prevBid)) {
            myBid = FHE.add(prevBid, bidAmount);
        } else {
            if (auctionBidders[auctionId].length >= MAX_BIDDERS_PER_AUCTION) revert TooManyBidders();
            myBid = bidAmount;
            userBids[msg.sender].push(auctionId);
            auctionBidders[auctionId].push(msg.sender);
        }
        auctionBids[auctionId][msg.sender] = myBid;
        FHE.allowThis(myBid);
        FHE.allow(myBid, msg.sender);

        // 与当前 winner 比较，严格大于才替换
        if (!FHE.isInitialized(winnerBid[auctionId])) {
            winnerBid[auctionId]       = myBid;
            encryptedWinner[auctionId] = FHE.asEaddress(msg.sender);
        } else {
            ebool isHigher = FHE.gt(myBid, winnerBid[auctionId]);
            winnerBid[auctionId]       = FHE.select(isHigher, myBid,                      winnerBid[auctionId]);
            encryptedWinner[auctionId] = FHE.select(isHigher, FHE.asEaddress(msg.sender), encryptedWinner[auctionId]);
        }
        FHE.allowThis(winnerBid[auctionId]);
        FHE.allowThis(encryptedWinner[auctionId]);

        emit BidPlaced(auctionId, msg.sender);
    }

    // ─── 解析 winner ──────────────────────────────────────────────────────────

    /**
     * @notice 第一步：拍卖结束后，任何人调用此函数，将 encryptedWinner 标记为可公开解密
     * @dev 调用后，KMS/relayer 可对该句柄进行公开解密，返回明文地址、abiEncodedClearValues 和 decryptionProof
     */
    function requestWinnerDecryption(
        uint256 auctionId
    ) external auctionExists(auctionId) onlyAfterEnd(auctionId) {
        require(auctionWinner[auctionId] == address(0), "Already resolved");
        require(FHE.isInitialized(encryptedWinner[auctionId]), "No bids placed");
        FHE.makePubliclyDecryptable(encryptedWinner[auctionId]);
    }

    /**
     * @notice 第二步：提交 KMS 公开解密证明，将明文 winner 地址写入合约
     *
     * 前端/测试流程：
     *   1. 调用 requestWinnerDecryption —— 合约执行 makePubliclyDecryptable
     *   2. 通过 KMS/relayer publicDecrypt 解密，得到：
     *      - winner（明文地址）
     *      - abiEncodedClearValues
     *      - decryptionProof
     *   3. 调用 resolveWinner 提交证明，合约验证 KMS 签名后写入 winner
     *
     * @param auctionId             拍卖 ID
     * @param winner                KMS 解密得到的明文 winner 地址
     * @param abiEncodedClearValues KMS 返回的 ABI 编码解密值
     * @param decryptionProof       KMS 签名证明
     */
    function resolveWinner(
        uint256 auctionId,
        address winner,
        bytes calldata abiEncodedClearValues,
        bytes calldata decryptionProof
    ) external auctionExists(auctionId) onlyAfterEnd(auctionId) {
        require(auctionWinner[auctionId] == address(0), "Already resolved");
        require(winner != address(0),                   "Invalid winner");
        require(FHE.isInitialized(encryptedWinner[auctionId]), "No bids placed");

        // 构造 handlesList，用于 KMS 签名验证
        bytes32[] memory handlesList = new bytes32[](1);
        handlesList[0] = eaddress.unwrap(encryptedWinner[auctionId]);

        // 验证 KMS 签名：确保 winner 地址来自真实的 KMS 解密，防止任何人伪造
        FHE.checkSignatures(handlesList, abiEncodedClearValues, decryptionProof);

        auctionWinner[auctionId] = winner;
        emit WinnerResolved(auctionId, winner);
    }

    // ─── 非 winner 取回竞拍金 ────────────────────────────────────────────────

    /**
     * @notice 非 winner 在拍卖结束且 winner 确认后取回自己的 98% 竞拍金
     */
    function withdraw(uint256 auctionId)
        external
        auctionExists(auctionId)
        onlyAfterEnd(auctionId)
        nonReentrant
        whenNotPaused
    {
        require(auctionWinner[auctionId] != address(0),  "Winner not resolved yet");
        require(msg.sender != auctionWinner[auctionId],  "Winner cannot withdraw, use claimNFT");
        require(!hasWithdrawn[auctionId][msg.sender],    "Already withdrawn");

        euint64 myBid = auctionBids[auctionId][msg.sender];
        require(FHE.isInitialized(myBid), "No bid found");

        hasWithdrawn[auctionId][msg.sender] = true;
        auctionBids[auctionId][msg.sender]  = FHE.asEuint64(0);

        FHE.allowTransient(myBid, address(confidentialToken));
        confidentialToken.confidentialTransfer(msg.sender, myBid);

        emit BidWithdrawn(auctionId, msg.sender);
    }

    // ─── Winner 领取 NFT ──────────────────────────────────────────────────────

    /**
     * @notice Winner 领取 NFT，合约将其竞拍金转给卖家
     */
    function claimNFT(uint256 auctionId)
        external
        auctionExists(auctionId)
        onlyAfterEnd(auctionId)
        nonReentrant
        whenNotPaused
    {
        Auction storage a = auctions[auctionId];
        require(!a.nftClaimed,                            "NFT already claimed");
        require(auctionWinner[auctionId] != address(0),   "Winner not resolved yet");
        require(msg.sender == auctionWinner[auctionId],   "Not the winner");

        euint64 winnerBidAmount = auctionBids[auctionId][msg.sender];
        require(FHE.isInitialized(winnerBidAmount), "No bid found");

        // 竞拍金转给卖家
        auctionBids[auctionId][msg.sender] = FHE.asEuint64(0);
        FHE.allowTransient(winnerBidAmount, address(confidentialToken));
        confidentialToken.confidentialTransfer(a.beneficiary, winnerBidAmount);

        // 转移 NFT 给 winner
        _transfer(address(this), msg.sender, a.nftTokenId);
        a.nftClaimed = true;

        emit NFTClaimed(auctionId, msg.sender, a.nftTokenId);
    }

    // ─── 紧急管理 ─────────────────────────────────────────────────────────────

    function pause()   external onlyOwner { paused = true;  }
    function unpause() external onlyOwner { paused = false; }

    // ─── ERC721 Receiver ──────────────────────────────────────────────────────

    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
