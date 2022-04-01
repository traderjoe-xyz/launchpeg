// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "erc721a/contracts/extensions/ERC721AOwnersExplicit.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract LaunchPeg is Ownable, ERC721AOwnersExplicit, ReentrancyGuard {
    enum Phase {
        NotStarted,
        DutchAuction,
        Mintlist,
        PublicSale
    }

    uint256 public immutable amountForDevs;
    uint256 public immutable amountForAuctionAndDev;
    uint256 public immutable maxPerAddressDuringMint;
    uint256 public immutable maxBatchSize;
    uint256 public immutable collectionSize;

    uint32 public auctionSaleStartTime;
    uint256 public auctionStartPrice;
    uint256 public auctionEndPrice;
    uint256 public auctionPriceCurveLength;
    uint256 public auctionDropInterval;
    uint256 public auctionDropPerStep;

    uint32 public mintlistStartTime;
    uint256 public mintlistPrice;

    uint32 public publicSaleStartTime;
    uint256 public publicSalePrice;

    mapping(address => uint256) public allowlist;

    modifier atPhase(Phase _phase) {
        _atPhase(_phase);
        _;
    }

    modifier callerIsUser() {
        require(tx.origin == msg.sender, "The caller is another contract");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxBatchSize_,
        uint256 collectionSize_,
        uint256 amountForAuctionAndDev_,
        uint256 amountForDevs_
    ) ERC721A(name_, symbol_) {
        collectionSize = collectionSize_;
        maxBatchSize = maxBatchSize_;
        maxPerAddressDuringMint = maxBatchSize_;
        amountForAuctionAndDev = amountForAuctionAndDev_;
        amountForDevs = amountForDevs_;
        require(
            amountForAuctionAndDev_ <= collectionSize_,
            "larger collection size needed"
        );
    }

    function initializePhases(
        uint32 auctionSaleStartTime_,
        uint256 auctionStartPrice_,
        uint256 auctionEndPrice_,
        uint256 auctionPriceCurveLength_,
        uint256 auctionDropInterval_,
        uint32 mintlistStartTime_,
        uint256 mintlistPrice_,
        uint32 publicSaleStartTime_,
        uint256 publicSalePrice_
    ) external atPhase(Phase.NotStarted) {
        require(auctionSaleStartTime == 0, "auction already initialized");
        auctionSaleStartTime = auctionSaleStartTime_;
        auctionStartPrice = auctionStartPrice_;
        auctionEndPrice = auctionEndPrice_;
        auctionPriceCurveLength = auctionPriceCurveLength_;
        auctionDropInterval = auctionDropInterval_;
        require(
            auctionStartPrice_ > auctionEndPrice_,
            "auction start price lower than end price"
        );
        auctionDropPerStep =
            (auctionStartPrice_ - auctionEndPrice_) /
            (auctionPriceCurveLength_ / auctionDropInterval_);

        mintlistStartTime = mintlistStartTime_;
        mintlistPrice = mintlistPrice_;
        require(
            mintlistStartTime_ > auctionSaleStartTime,
            "mintlist phase must be after auction sale"
        );

        publicSaleStartTime = publicSaleStartTime_;
        publicSalePrice = publicSalePrice_;
        require(
            publicSaleStartTime_ > mintlistStartTime_,
            "public sale must be after mintlist"
        );
    }

    function seedAllowlist(
        address[] memory addresses,
        uint256[] memory numSlots
    ) external onlyOwner {
        require(
            addresses.length == numSlots.length,
            "addresses does not match numSlots length"
        );
        for (uint256 i = 0; i < addresses.length; i++) {
            allowlist[addresses[i]] = numSlots[i];
        }
    }

    function auctionMint(uint256 quantity)
        external
        payable
        callerIsUser
        atPhase(Phase.DutchAuction)
    {
        uint256 _saleStartTime = uint256(auctionSaleStartTime);
        require(
            totalSupply() + quantity <= amountForAuctionAndDev,
            "not enough remaining reserved for auction to support desired mint amount"
        );
        require(
            numberMinted(msg.sender) + quantity <= maxPerAddressDuringMint,
            "can not mint this many"
        );
        uint256 totalCost = getAuctionPrice(_saleStartTime) * quantity;
        _safeMint(msg.sender, quantity);
        refundIfOver(totalCost);
    }

    function allowlistMint()
        external
        payable
        callerIsUser
        atPhase(Phase.Mintlist)
    {
        require(allowlist[msg.sender] > 0, "not eligible for allowlist mint");
        require(totalSupply() + 1 <= collectionSize, "reached max supply");
        allowlist[msg.sender]--;
        _safeMint(msg.sender, 1);
        refundIfOver(mintlistPrice);
    }

    function publicSaleMint(uint256 quantity)
        external
        payable
        callerIsUser
        atPhase(Phase.PublicSale)
    {
        require(
            totalSupply() + quantity <= collectionSize,
            "reached max supply"
        );
        require(
            numberMinted(msg.sender) + quantity <= maxPerAddressDuringMint,
            "can not mint this many"
        );
        _safeMint(msg.sender, quantity);
        refundIfOver(publicSalePrice * quantity);
    }

    function refundIfOver(uint256 price) private {
        require(msg.value >= price, "Need to send more AVAX.");
        if (msg.value > price) {
            payable(msg.sender).transfer(msg.value - price);
        }
    }

    function getAuctionPrice(uint256 _saleStartTime)
        public
        view
        returns (uint256)
    {
        if (block.timestamp < _saleStartTime) {
            return auctionStartPrice;
        }
        if (block.timestamp - _saleStartTime >= auctionPriceCurveLength) {
            return auctionEndPrice;
        } else {
            uint256 steps = (block.timestamp - _saleStartTime) /
                auctionDropInterval;
            return auctionStartPrice - (steps * auctionDropPerStep);
        }
    }

    function currentPhase() public view returns (Phase) {
        if (
            auctionSaleStartTime == 0 ||
            mintlistStartTime == 0 ||
            publicSaleStartTime == 0 ||
            block.timestamp < auctionSaleStartTime
        ) {
            return Phase.NotStarted;
        } else if (
            block.timestamp >= auctionSaleStartTime &&
            block.timestamp < mintlistStartTime
        ) {
            return Phase.DutchAuction;
        } else if (
            block.timestamp >= mintlistStartTime &&
            block.timestamp < publicSaleStartTime
        ) {
            return Phase.Mintlist;
        }
        return Phase.PublicSale;
    }

    function _atPhase(Phase _phase) internal view {
        require(currentPhase() == _phase, "LaunchPeg: wrong phase");
    }

    // For marketing etc.
    function devMint(uint256 quantity) external onlyOwner {
        require(
            totalSupply() + quantity <= amountForDevs,
            "too many already minted before dev mint"
        );
        require(
            quantity % maxBatchSize == 0,
            "can only mint a multiple of the maxBatchSize"
        );
        uint256 numChunks = quantity / maxBatchSize;
        for (uint256 i = 0; i < numChunks; i++) {
            _safeMint(msg.sender, maxBatchSize);
        }
    }

    // // metadata URI
    string private _baseTokenURI;

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    function setBaseURI(string calldata baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    function withdrawMoney() external onlyOwner nonReentrant {
        (bool success, ) = msg.sender.call{value: address(this).balance}("");
        require(success, "Transfer failed.");
    }

    function setOwnersExplicit(uint256 quantity)
        external
        onlyOwner
        nonReentrant
    {
        _setOwnersExplicit(quantity);
    }

    function numberMinted(address owner) public view returns (uint256) {
        return _numberMinted(owner);
    }

    function getOwnershipData(uint256 tokenId)
        external
        view
        returns (TokenOwnership memory)
    {
        return _ownershipOf(tokenId);
    }
}
