// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "erc721a/contracts/ERC721A.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract LaunchPeg is Ownable, ERC721A, ReentrancyGuard {
    enum Phase {
        NotStarted,
        DutchAuction,
        Mintlist,
        PublicSale
    }

    uint256 public immutable amountForDevs;
    uint256 public immutable amountForAuction;
    uint256 public immutable amountForMintlist;
    uint256 public immutable maxPerAddressDuringMint;
    uint256 public immutable maxBatchSize;
    uint256 public immutable collectionSize;

    uint256 public auctionSaleStartTime;
    uint256 public mintlistStartTime;
    uint256 public publicSaleStartTime;

    uint256 public auctionStartPrice;
    uint256 public auctionEndPrice;
    uint256 public auctionSaleDuration;
    uint256 public auctionDropInterval;
    uint256 public auctionDropPerStep;

    uint256 public lastAuctionPrice;
    uint256 public mintlistDiscount;
    uint256 public publicSaleDiscount;

    mapping(address => uint256) public allowlist;

    address public projectOwner;

    string private _baseTokenURI;

    modifier atPhase(Phase _phase) {
        require(currentPhase() == _phase, "LaunchPeg: wrong phase");
        _;
    }

    modifier isEOA() {
        require(tx.origin == msg.sender, "The caller is another contract");
        _;
    }

    modifier onlyProjectOwner() {
        require(
            projectOwner == msg.sender,
            "The caller is not the project owner"
        );
        _;
    }

    constructor(
        string memory _name,
        string memory _symbol,
        address _projectOwner,
        uint256 _maxBatchSize,
        uint256 _collectionSize,
        uint256 _amountForAuction,
        uint256 _amountForMintlist,
        uint256 _amountForDevs
    ) ERC721A(_name, _symbol) {
        require(
            _amountForAuction + _amountForMintlist + _amountForDevs <=
                _collectionSize,
            "larger collection size needed"
        );
        projectOwner = _projectOwner;
        collectionSize = _collectionSize;
        maxBatchSize = _maxBatchSize;
        maxPerAddressDuringMint = _maxBatchSize;
        amountForAuction = _amountForAuction;
        amountForMintlist = _amountForMintlist;
        amountForDevs = _amountForDevs;
    }

    function initializePhases(
        uint32 _auctionSaleStartTime,
        uint256 _auctionStartPrice,
        uint256 _auctionEndPrice,
        uint256 _auctionSaleDuration,
        uint256 _auctionDropInterval,
        uint32 _mintlistStartTime,
        uint256 _mintlistDiscount,
        uint32 _publicSaleStartTime,
        uint256 _publicSaleDiscount
    ) external atPhase(Phase.NotStarted) {
        require(
            auctionSaleStartTime == 0 && _auctionSaleStartTime != 0,
            "auction already initialized"
        );
        auctionSaleStartTime = _auctionSaleStartTime;
        auctionStartPrice = _auctionStartPrice;
        lastAuctionPrice = _auctionStartPrice;
        auctionEndPrice = _auctionEndPrice;
        auctionSaleDuration = _auctionSaleDuration;
        auctionDropInterval = _auctionDropInterval;
        require(
            _auctionStartPrice > _auctionEndPrice,
            "auction start price lower than end price"
        );
        auctionDropPerStep =
            (_auctionStartPrice - _auctionEndPrice) /
            (_auctionSaleDuration / _auctionDropInterval);

        mintlistStartTime = _mintlistStartTime;
        mintlistDiscount = _mintlistDiscount;
        require(
            _mintlistStartTime > auctionSaleStartTime,
            "mintlist phase must be after auction sale"
        );

        publicSaleStartTime = _publicSaleStartTime;
        publicSaleDiscount = _publicSaleDiscount;
        require(
            _publicSaleStartTime > _mintlistStartTime,
            "public sale must be after mintlist"
        );
    }

    function seedAllowlist(
        address[] memory _addresses,
        uint256[] memory _numSlots
    ) external onlyOwner {
        require(
            _addresses.length == _numSlots.length,
            "addresses does not match numSlots length"
        );
        for (uint256 i = 0; i < _addresses.length; i++) {
            allowlist[_addresses[i]] = _numSlots[i];
        }
    }

    function auctionMint(uint256 _quantity)
        external
        payable
        isEOA
        atPhase(Phase.DutchAuction)
    {
        uint256 _remainingSupply = amountForAuction +
            amountForDevs -
            totalSupply();
        require(_remainingSupply > 0, "auction sold out");
        if (_remainingSupply < _quantity) {
            _quantity = _remainingSupply;
        }
        require(
            numberMinted(msg.sender) + _quantity <= maxPerAddressDuringMint,
            "can not mint this many"
        );
        lastAuctionPrice = getAuctionPrice(auctionSaleStartTime);
        uint256 totalCost = lastAuctionPrice * _quantity;
        _safeMint(msg.sender, _quantity);
        refundIfOver(totalCost);
    }

    function allowlistMint() external payable isEOA atPhase(Phase.Mintlist) {
        require(allowlist[msg.sender] > 0, "not eligible for allowlist mint");
        require(totalSupply() + 1 <= collectionSize, "reached max supply");
        allowlist[msg.sender]--;
        _safeMint(msg.sender, 1);
        refundIfOver(getMintlistPrice());
    }

    function getMintlistPrice() public view returns (uint256) {
        return lastAuctionPrice - mintlistDiscount;
    }

    function publicSaleMint(uint256 _quantity)
        external
        payable
        isEOA
        atPhase(Phase.PublicSale)
    {
        require(
            totalSupply() + _quantity <= collectionSize,
            "reached max supply"
        );
        require(
            numberMinted(msg.sender) + _quantity <= maxPerAddressDuringMint,
            "can not mint this many"
        );
        _safeMint(msg.sender, _quantity);
        refundIfOver(getPublicSalePrice() * _quantity);
    }

    function getPublicSalePrice() public view returns (uint256) {
        return lastAuctionPrice - publicSaleDiscount;
    }

    function refundIfOver(uint256 _price) private {
        require(msg.value >= _price, "Need to send more AVAX.");
        if (msg.value > _price) {
            (bool sent, ) = payable(msg.sender).call{value: msg.value - _price}(
                ""
            );
            require(sent, "refund failed");
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
        if (block.timestamp - _saleStartTime >= auctionSaleDuration) {
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

    function setProjectOwner(address projectOwner_) external onlyOwner {
        projectOwner = projectOwner_;
    }

    function devMint(uint256 quantity) external onlyProjectOwner {
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
