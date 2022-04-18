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
    /// @inheritdoc ILaunchPeg
    uint256 public immutable override amountForAuction;

    /// @inheritdoc ILaunchPeg
    uint256 public immutable override amountForMintlist;

    /// @dev Tracks the amount of NFTs minted during the dutch auction
    uint256 private amountMintedDuringAuction;

    /// @inheritdoc ILaunchPeg
    uint256 public override auctionSaleStartTime;

    /// @inheritdoc ILaunchPeg
    uint256 public override mintlistStartTime;

    /// @inheritdoc ILaunchPeg
    uint256 public override publicSaleStartTime;

    /// @inheritdoc ILaunchPeg
    uint256 public override auctionStartPrice;

    /// @inheritdoc ILaunchPeg
    uint256 public override auctionEndPrice;

    /// @inheritdoc ILaunchPeg
    uint256 public override auctionSaleDuration;

    /// @inheritdoc ILaunchPeg
    uint256 public override auctionDropInterval;

    /// @inheritdoc ILaunchPeg
    uint256 public override auctionDropPerStep;

    /// @notice The price of the last NFT sold during the auction
    /// @dev lastAuctionPrice is scaled to 1e18
    uint256 private lastAuctionPrice;

    /// @inheritdoc ILaunchPeg
    uint256 public override mintlistDiscountPercent;

    /// @inheritdoc ILaunchPeg
    uint256 public override publicSaleDiscountPercent;

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
        address _royaltyReceiver,
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
            _royaltyReceiver,
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
