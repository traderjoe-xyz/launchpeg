// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "erc721a/contracts/ERC721A.sol";
import "./LaunchPegErrors.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @title LaunchPeg
/// @author Trader Joe
/// @notice Implements a fair and gas efficient NFT launch mechanism. The sale takes place in 3 phases: dutch auction, allowlist mint, public sale.
contract LaunchPeg is Ownable, ERC721A, ReentrancyGuard {
    enum Phase {
        NotStarted,
        DutchAuction,
        Mintlist,
        PublicSale
    }

    /// @notice The collection size (e.g 10000)
    uint256 public immutable collectionSize;

    /// @notice Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @dev It can be minted any time via `devMint`
    uint256 public immutable amountForDevs;

    /// @notice Amount of NFTs available for the auction (e.g 8000)
    /// Unsold items are put up for sale during the public sale.
    uint256 public immutable amountForAuction;

    /// @notice Amount of NFTs available for the allowlist mint (e.g 1000)
    /// Unsold items are put up for sale during the public sale.
    uint256 public immutable amountForMintlist;

    /// @notice Max amount of NFTs an address can mint
    uint256 public immutable maxPerAddressDuringMint;

    /// @notice Max amout of NFTs that can be minted at once
    uint256 public immutable maxBatchSize;

    /// @notice Tracks the amount of NFTs minted by `projectOwner`
    uint256 public amountMintedByDevs;

    /// @notice Tracks the amount of NFTs minted during the dutch auction
    uint256 public amountMintedDuringAuction;

    /// @notice Start time of the dutch auction in seconds
    uint256 public auctionSaleStartTime;

    /// @notice Start time of the allowlist mint in seconds
    /// @dev It must be greater than the dutch auction start
    uint256 public mintlistStartTime;

    /// @notice Start time of the public sale in seconds
    /// @dev It must be greater than the allowlist mint start
    uint256 public publicSaleStartTime;

    /// @notice Auction start price in AVAX
    /// @dev auctionStartPrice is scaled to 1e18
    uint256 public auctionStartPrice;

    /// @notice Auction floor price in AVAX
    /// @dev auctionEndPrice is scaled to 1e18
    uint256 public auctionEndPrice;

    /// @notice Duration of the auction in seconds
    /// @dev auctionSaleStartTime - mintlistStartTime
    uint256 public auctionSaleDuration;

    /// @notice Time elapsed between each drop in price
    /// @dev in seconds
    uint256 public auctionDropInterval;

    /// @notice Amount in AVAX deducted at each interval
    uint256 public auctionDropPerStep;

    /// @notice The price of the last NFT sold during the auction
    /// @dev lastAuctionPrice is scaled to 1e18
    uint256 public lastAuctionPrice;

    /// @notice The discount applied to the last auction price during the allowlist mint
    /// @dev in basis points e.g 500 for 5%
    uint256 public mintlistDiscountPercent;

    /// @notice The discount applied to the last auction price during the public sale
    /// @dev in basis points e.g 2500 for 25%
    uint256 public publicSaleDiscountPercent;

    /// @notice The amount of NFTs each allowed address can mint during the allowlist mint
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
        auctionSaleDuration = _mintlistStartTime - _auctionSaleStartTime;
        auctionDropInterval = _auctionDropInterval;
        auctionDropPerStep =
            (_auctionStartPrice - _auctionEndPrice) /
            (auctionSaleDuration / _auctionDropInterval);

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
