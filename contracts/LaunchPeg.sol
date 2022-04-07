// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "erc721a/contracts/ERC721A.sol";
import "./LaunchPegErrors.sol";
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

    uint256 public amountMintedByDevs;
    uint256 public amountMintedDuringAuction;

    uint256 public auctionSaleStartTime;
    uint256 public mintlistStartTime;
    uint256 public publicSaleStartTime;

    uint256 public auctionStartPrice;
    uint256 public auctionEndPrice;
    uint256 public auctionSaleDuration;
    uint256 public auctionDropInterval;
    uint256 public auctionDropPerStep;

    uint256 public lastAuctionPrice;
    uint256 public mintlistDiscountPercent;
    uint256 public publicSaleDiscountPercent;

    mapping(address => uint256) public allowlist;

    address public projectOwner;

    string private _baseTokenURI;

    modifier atPhase(Phase _phase) {
        if (currentPhase() != _phase) {
            revert LaunchPeg__WrongPhase();
        }
        _;
    }

    modifier isEOA() {
        if (tx.origin != msg.sender) {
            revert LaunchPeg__Unauthorized();
        }
        _;
    }

    modifier onlyProjectOwner() {
        if (projectOwner != msg.sender) {
            revert LaunchPeg__Unauthorized();
        }
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
        if (
            _amountForAuction + _amountForMintlist + _amountForDevs >
            _collectionSize
        ) {
            revert LaunchPeg__LargerCollectionSizeNeeded();
        }

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
        uint256 _mintlistDiscountPercent,
        uint32 _publicSaleStartTime,
        uint256 _publicSaleDiscountPercent
    ) external atPhase(Phase.NotStarted) {
        if (auctionSaleStartTime != 0) {
            revert LaunchPeg__AuctionAlreadyInitialized();
        }
        if (_auctionSaleStartTime == 0) {
            revert LaunchPeg__InvalidAuctionStartTime();
        }
        if (_auctionStartPrice <= _auctionEndPrice) {
            revert LaunchPeg__EndPriceGreaterThanStartPrice();
        }
        if (_mintlistStartTime <= _auctionSaleStartTime) {
            revert LaunchPeg__MintlistBeforeAuction();
        }
        if (_publicSaleStartTime <= _mintlistStartTime) {
            revert LaunchPeg__PublicSaleBeforeMintlist();
        }

        auctionSaleStartTime = _auctionSaleStartTime;
        auctionStartPrice = _auctionStartPrice;
        lastAuctionPrice = _auctionStartPrice;
        auctionEndPrice = _auctionEndPrice;
        auctionSaleDuration = _auctionSaleDuration;
        auctionDropInterval = _auctionDropInterval;
        auctionDropPerStep =
            (_auctionStartPrice - _auctionEndPrice) /
            (_auctionSaleDuration / _auctionDropInterval);

        mintlistStartTime = _mintlistStartTime;
        mintlistDiscountPercent = _mintlistDiscountPercent;

        publicSaleStartTime = _publicSaleStartTime;
        publicSaleDiscountPercent = _publicSaleDiscountPercent;
    }

    function seedAllowlist(
        address[] memory _addresses,
        uint256[] memory _numSlots
    ) external onlyOwner {
        if (_addresses.length != _numSlots.length) {
            revert LaunchPeg__WrongAddressesAndNumSlotsLength();
        }
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
        uint256 _remainingSupply = (amountForAuction + amountMintedByDevs) -
            totalSupply();
        if (_remainingSupply == 0) {
            revert LaunchPeg__MaxSupplyReached();
        }
        if (_remainingSupply < _quantity) {
            _quantity = _remainingSupply;
        }
        if (numberMinted(msg.sender) + _quantity > maxPerAddressDuringMint) {
            revert LaunchPeg__CanNotMintThisMany();
        }
        lastAuctionPrice = getAuctionPrice(auctionSaleStartTime);
        uint256 totalCost = lastAuctionPrice * _quantity;
        refundIfOver(totalCost);
        _safeMint(msg.sender, _quantity);
        amountMintedDuringAuction = amountMintedDuringAuction + _quantity;
    }

    function allowlistMint() external payable isEOA atPhase(Phase.Mintlist) {
        if (allowlist[msg.sender] <= 0) {
            revert LaunchPeg__NotEligibleForAllowlistMint();
        }
        uint256 _remainingAuctionSupply = amountForAuction -
            amountMintedDuringAuction;
        if (
            totalSupply() + _remainingAuctionSupply + 1 >
            amountForAuction + amountForMintlist + amountMintedByDevs
        ) {
            revert LaunchPeg__MaxSupplyReached();
        }
        allowlist[msg.sender]--;
        refundIfOver(getMintlistPrice());
        _safeMint(msg.sender, 1);
    }

    function getMintlistPrice() public view returns (uint256) {
        return
            lastAuctionPrice -
            (lastAuctionPrice * mintlistDiscountPercent) /
            10000;
    }

    function publicSaleMint(uint256 _quantity)
        external
        payable
        isEOA
        atPhase(Phase.PublicSale)
    {
        if (
            totalSupply() + _quantity >
            collectionSize - (amountForDevs - amountMintedByDevs)
        ) {
            revert LaunchPeg__MaxSupplyReached();
        }
        if (numberMinted(msg.sender) + _quantity > maxPerAddressDuringMint) {
            revert LaunchPeg__CanNotMintThisMany();
        }
        refundIfOver(getPublicSalePrice() * _quantity);
        _safeMint(msg.sender, _quantity);
    }

    function getPublicSalePrice() public view returns (uint256) {
        return
            lastAuctionPrice -
            (lastAuctionPrice * publicSaleDiscountPercent) /
            10000;
    }

    function refundIfOver(uint256 _price) private {
        if (msg.value < _price) {
            revert LaunchPeg__NotEnoughAVAX(msg.value);
        }
        if (msg.value > _price) {
            (bool success, ) = payable(msg.sender).call{
                value: msg.value - _price
            }("");
            if (!success) {
                revert LaunchPeg__TransferFailed();
            }
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
        if (amountMintedByDevs + quantity > amountForDevs) {
            revert LaunchPeg__MaxSupplyReached();
        }
        if (quantity % maxBatchSize != 0) {
            revert LaunchPeg__CanOnlyMintMultipleOfMaxBatchSize();
        }
        uint256 numChunks = quantity / maxBatchSize;
        for (uint256 i = 0; i < numChunks; i++) {
            _safeMint(msg.sender, maxBatchSize);
        }
        amountMintedByDevs = amountMintedByDevs + quantity;
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    function setBaseURI(string calldata baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    function withdrawMoney() external onlyOwner nonReentrant {
        (bool success, ) = msg.sender.call{value: address(this).balance}("");
        if (!success) {
            revert LaunchPeg__TransferFailed();
        }
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
