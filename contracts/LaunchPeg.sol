// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "erc721a/contracts/ERC721A.sol";
import "./BatchReveal.sol";

import "./BaseLaunchPeg.sol";
import "./interfaces/ILaunchPeg.sol";
import "./LaunchPegErrors.sol";

/// @title LaunchPeg
/// @author Trader Joe
/// @notice Implements a fair and gas efficient NFT launch mechanism. The sale takes place in 3 phases: dutch auction, allowlist mint, public sale.
contract LaunchPeg is BaseLaunchPeg, ILaunchPeg {
    /// @notice Amount of NFTs available for the auction (e.g 8000)
    /// Unsold items are put up for sale during the public sale.
    uint256 public immutable amountForAuction;

    /// @notice Amount of NFTs available for the allowlist mint (e.g 1000)
    /// Unsold items are put up for sale during the public sale.
    uint256 public immutable amountForMintlist;

    /// @dev Tracks the amount of NFTs minted during the dutch auction
    uint256 private amountMintedDuringAuction;

    /// @notice Start time of the dutch auction in seconds
    /// @dev Timestamp
    uint256 public auctionSaleStartTime;

    /// @notice Start time of the allowlist mint in seconds
    /// @dev A timestamp greater than the dutch auction start
    uint256 public mintlistStartTime;

    /// @notice Start time of the public sale in seconds
    /// @dev A timestamp greater than the allowlist mint start
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
    uint256 private lastAuctionPrice;

    /// @notice The discount applied to the last auction price during the allowlist mint
    /// @dev in basis points e.g 500 for 5%
    uint256 public mintlistDiscountPercent;

    /// @notice The discount applied to the last auction price during the public sale
    /// @dev in basis points e.g 2500 for 25%
    uint256 public publicSaleDiscountPercent;

    /// @notice The amount of NFTs each allowed address can mint during the allowlist mint
    mapping(address => uint256) public allowlist;

    modifier atPhase(Phase _phase) {
        if (currentPhase() != _phase) {
            revert LaunchPeg__WrongPhase();
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
        uint256 _amountForDevs,
        uint256 _batchRevealSize
    )
        BaseLaunchPeg(
            _name,
            _symbol,
            _projectOwner,
            _maxBatchSize,
            _collectionSize,
            _amountForDevs,
            _batchRevealSize
        )
    {
        if (
            _amountForAuction + _amountForMintlist + _amountForDevs >
            _collectionSize
        ) {
            revert LaunchPeg__LargerCollectionSizeNeeded();
        }

        amountForAuction = _amountForAuction;
        amountForMintlist = _amountForMintlist;
    }

    /// @inheritdoc ILaunchPeg
    function initializePhases(
        uint256 _auctionSaleStartTime,
        uint256 _auctionStartPrice,
        uint256 _auctionEndPrice,
        uint256 _auctionDropInterval,
        uint256 _mintlistStartTime,
        uint256 _mintlistDiscountPercent,
        uint256 _publicSaleStartTime,
        uint256 _publicSaleDiscountPercent,
        uint256 _revealStartTime,
        uint256 _revealInterval
    ) external override atPhase(Phase.NotStarted) {
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
        if (
            _mintlistDiscountPercent > 10000 ||
            _publicSaleDiscountPercent > 10000
        ) {
            revert LaunchPeg__InvalidPercent();
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

        revealStartTime = _revealStartTime;
        revealInterval = _revealInterval;

        emit Initialized(
            name(),
            symbol(),
            projectOwner,
            maxBatchSize,
            collectionSize,
            amountForAuction,
            amountForMintlist,
            amountForDevs,
            auctionSaleStartTime,
            auctionStartPrice,
            auctionEndPrice,
            auctionDropInterval,
            mintlistStartTime,
            mintlistDiscountPercent,
            publicSaleStartTime,
            publicSaleDiscountPercent
        );

        emit RevealInitialized(
            revealStartTime,
            revealInterval,
            revealBatchSize
        );
    }

    /// @inheritdoc ILaunchPeg
    function seedAllowlist(
        address[] memory _addresses,
        uint256[] memory _numSlots
    ) external override onlyOwner {
        if (_addresses.length != _numSlots.length) {
            revert LaunchPeg__WrongAddressesAndNumSlotsLength();
        }
        for (uint256 i = 0; i < _addresses.length; i++) {
            allowlist[_addresses[i]] = _numSlots[i];
        }
    }

    /// @inheritdoc ILaunchPeg
    function auctionMint(uint256 _quantity)
        external
        payable
        override
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
        emit Mint(
            msg.sender,
            _quantity,
            lastAuctionPrice,
            _totalMinted() - _quantity,
            Phase.DutchAuction
        );
    }

    /// @inheritdoc ILaunchPeg
    function allowlistMint()
        external
        payable
        override
        isEOA
        atPhase(Phase.Mintlist)
    {
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
        uint256 price = getMintlistPrice();
        refundIfOver(price);
        _safeMint(msg.sender, 1);
        emit Mint(msg.sender, 1, price, _totalMinted() - 1, Phase.Mintlist);
    }

    /// @inheritdoc ILaunchPeg
    function getMintlistPrice() public view override returns (uint256) {
        return
            lastAuctionPrice -
            (lastAuctionPrice * mintlistDiscountPercent) /
            10000;
    }

    /// @inheritdoc ILaunchPeg
    function publicSaleMint(uint256 _quantity)
        external
        payable
        override
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
        uint256 price = getPublicSalePrice();
        refundIfOver(price * _quantity);
        _safeMint(msg.sender, _quantity);
        emit Mint(
            msg.sender,
            _quantity,
            price,
            _totalMinted() - _quantity,
            Phase.PublicSale
        );
    }

    /// @inheritdoc ILaunchPeg
    function getPublicSalePrice() public view override returns (uint256) {
        return
            lastAuctionPrice -
            (lastAuctionPrice * publicSaleDiscountPercent) /
            10000;
    }

    /// @inheritdoc ILaunchPeg
    function getAuctionPrice(uint256 _saleStartTime)
        public
        view
        override
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

    /// @inheritdoc ILaunchPeg
    function currentPhase() public view override returns (Phase) {
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
}
