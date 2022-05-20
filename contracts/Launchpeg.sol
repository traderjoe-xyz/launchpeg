// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";

import "./BaseLaunchpeg.sol";
import "./interfaces/ILaunchpeg.sol";

/// @title Launchpeg
/// @author Trader Joe
/// @notice Implements a fair and gas efficient NFT launch mechanism. The sale takes place in 3 phases: dutch auction, allowlist mint, public sale.
contract Launchpeg is BaseLaunchpeg, ILaunchpeg {
    /// @notice Amount of NFTs available for the auction (e.g 8000)
    /// Unsold items are put up for sale during the public sale.
    uint256 public override amountForAuction;

    /// @notice Start time of the dutch auction in seconds
    /// @dev Timestamp
    uint256 public override auctionSaleStartTime;

    /// @notice Auction start price in AVAX
    /// @dev auctionStartPrice is scaled to 1e18
    uint256 public override auctionStartPrice;

    /// @notice Auction floor price in AVAX
    /// @dev auctionEndPrice is scaled to 1e18
    uint256 public override auctionEndPrice;

    /// @notice Duration of the auction in seconds
    /// @dev allowlistStartTime - auctionSaleStartTime
    uint256 public override auctionSaleDuration;

    /// @notice Time elapsed between each drop in price
    /// @dev In seconds
    uint256 public override auctionDropInterval;

    /// @notice Amount in AVAX deducted at each interval
    uint256 public override auctionDropPerStep;

    /// @notice The discount applied to the last auction price during the allowlist mint
    /// @dev In basis points e.g 500 for 5%
    uint256 public override allowlistDiscountPercent;

    /// @notice The discount applied to the last auction price during the public sale
    /// @dev In basis points e.g 2500 for 25%
    uint256 public override publicSaleDiscountPercent;

    /// @notice Tracks the amount of NFTs minted during the dutch auction
    uint256 public override amountMintedDuringAuction;

    /// @notice The price of the last NFT sold during the auction
    /// @dev lastAuctionPrice is scaled to 1e18
    uint256 public override lastAuctionPrice;

    /// @dev Emitted on initializePhases()
    /// @param auctionSaleStartTime Auction start time in seconds
    /// @param auctionStartPrice Auction start price in AVAX
    /// @param auctionEndPrice Auction floor price in AVAX
    /// @param auctionDropInterval Time elapsed between each drop in price in seconds
    /// @param allowlistStartTime allowlist mint start time in seconds
    /// @param allowlistDiscountPercent Discount applied to the last auction price during the allowlist mint
    /// @param publicSaleStartTime Public sale start time in seconds
    /// @param publicSaleDiscountPercent Discount applied to the last auction price during the public sale
    event Initialized(
        uint256 auctionSaleStartTime,
        uint256 auctionStartPrice,
        uint256 auctionEndPrice,
        uint256 auctionDropInterval,
        uint256 allowlistStartTime,
        uint256 allowlistDiscountPercent,
        uint256 publicSaleStartTime,
        uint256 publicSaleDiscountPercent
    );

    /// @dev Emitted on auctionMint(), allowlistMint(), publicSaleMint()
    /// @param sender The address that minted
    /// @param quantity Amount of NFTs minted
    /// @param price Price in AVAX for the NFTs
    /// @param startTokenId The token ID of the first minted NFT: if `startTokenId` = 100 and `quantity` = 2, `sender` minted 100 and 101
    /// @param phase The phase in which the mint occurs
    event Mint(
        address indexed sender,
        uint256 quantity,
        uint256 price,
        uint256 startTokenId,
        Phase phase
    );

    modifier atPhase(Phase _phase) {
        if (currentPhase() != _phase) {
            revert Launchpeg__WrongPhase();
        }
        _;
    }

    /// @notice Launchpeg initialization
    /// Can only be called once
    /// @param _name ERC721 name
    /// @param _symbol ERC721 symbol
    /// @param _projectOwner The project owner
    /// @param _royaltyReceiver Royalty fee collector
    /// @param _maxBatchSize Max amount of NFTs that can be minted at once
    /// @param _collectionSize The collection size (e.g 10000)
    /// @param _amountForAuction Amount of NFTs available for the auction (e.g 8000)
    /// @param _amountForAllowlist Amount of NFTs available for the allowlist mint (e.g 1000)
    /// @param _amountForDevs Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @param _batchRevealSize Size of the batch reveal
    /// @param _revealStartTime Start of the token URIs reveal in seconds
    /// @param _revealInterval Interval between two batch reveals in seconds
    function initialize(
        string memory _name,
        string memory _symbol,
        address _projectOwner,
        address _royaltyReceiver,
        uint256 _maxBatchSize,
        uint256 _collectionSize,
        uint256 _amountForAuction,
        uint256 _amountForAllowlist,
        uint256 _amountForDevs,
        uint256 _batchRevealSize,
        uint256 _revealStartTime,
        uint256 _revealInterval
    ) external override initializer {
        initializeBaseLaunchpeg(
            _name,
            _symbol,
            _projectOwner,
            _royaltyReceiver,
            _maxBatchSize,
            _collectionSize,
            _amountForDevs,
            _amountForAllowlist,
            _batchRevealSize,
            _revealStartTime,
            _revealInterval
        );
        if (
            _amountForAuction + _amountForAllowlist + _amountForDevs >
            _collectionSize
        ) {
            revert Launchpeg__LargerCollectionSizeNeeded();
        }

        amountForAuction = _amountForAuction;
    }

    /// @notice Initialize the three phases of the sale
    /// @dev Can only be called once
    /// @param _auctionSaleStartTime Auction start time in seconds
    /// @param _auctionStartPrice Auction start price in AVAX
    /// @param _auctionEndPrice Auction floor price in AVAX
    /// @param _auctionDropInterval Time elapsed between each drop in price in seconds
    /// @param _allowlistStartTime allowlist mint start time in seconds
    /// @param _allowlistDiscountPercent Discount applied to the last auction price during the allowlist mint
    /// @param _publicSaleStartTime Public sale start time in seconds
    /// @param _publicSaleDiscountPercent Discount applied to the last auction price during the public sale
    function initializePhases(
        uint256 _auctionSaleStartTime,
        uint256 _auctionStartPrice,
        uint256 _auctionEndPrice,
        uint256 _auctionDropInterval,
        uint256 _allowlistStartTime,
        uint256 _allowlistDiscountPercent,
        uint256 _publicSaleStartTime,
        uint256 _publicSaleDiscountPercent
    ) external override atPhase(Phase.NotStarted) {
        if (auctionSaleStartTime != 0) {
            revert Launchpeg__AuctionAlreadyInitialized();
        }
        if (_auctionSaleStartTime < block.timestamp) {
            revert Launchpeg__InvalidStartTime();
        }
        if (_auctionStartPrice <= _auctionEndPrice) {
            revert Launchpeg__EndPriceGreaterThanStartPrice();
        }
        if (_allowlistStartTime <= _auctionSaleStartTime) {
            revert Launchpeg__AllowlistBeforeAuction();
        }
        if (_publicSaleStartTime <= _allowlistStartTime) {
            revert Launchpeg__PublicSaleBeforeAllowlist();
        }
        if (
            _allowlistDiscountPercent > BASIS_POINT_PRECISION ||
            _publicSaleDiscountPercent > BASIS_POINT_PRECISION
        ) {
            revert Launchpeg__InvalidPercent();
        }

        auctionSaleDuration = _allowlistStartTime - _auctionSaleStartTime;
        /// Ensure auction drop interval is not too high by enforcing it
        /// is at most 1/4 of the auction sale duration.
        /// There will be at least 3 price drops.
        if (
            _auctionDropInterval == 0 ||
            _auctionDropInterval > auctionSaleDuration / 4
        ) {
            revert Launchpeg__InvalidAuctionDropInterval();
        }

        auctionSaleStartTime = _auctionSaleStartTime;
        auctionStartPrice = _auctionStartPrice;
        lastAuctionPrice = _auctionStartPrice;
        auctionEndPrice = _auctionEndPrice;
        auctionDropInterval = _auctionDropInterval;
        auctionDropPerStep =
            (_auctionStartPrice - _auctionEndPrice) /
            (auctionSaleDuration / _auctionDropInterval);

        allowlistStartTime = _allowlistStartTime;
        allowlistDiscountPercent = _allowlistDiscountPercent;

        publicSaleStartTime = _publicSaleStartTime;
        publicSaleDiscountPercent = _publicSaleDiscountPercent;

        emit Initialized(
            auctionSaleStartTime,
            auctionStartPrice,
            auctionEndPrice,
            auctionDropInterval,
            allowlistStartTime,
            allowlistDiscountPercent,
            publicSaleStartTime,
            publicSaleDiscountPercent
        );
    }

    /// @notice Mint NFTs during the dutch auction
    /// @dev The price decreases every `auctionDropInterval` by `auctionDropPerStep`
    /// @param _quantity Quantity of NFTs to buy
    function auctionMint(uint256 _quantity)
        external
        payable
        override
        atPhase(Phase.DutchAuction)
    {
        uint256 remainingSupply = (amountForAuction + amountMintedByDevs) -
            totalSupply();
        if (remainingSupply == 0) {
            revert Launchpeg__MaxSupplyReached();
        }
        if (remainingSupply < _quantity) {
            _quantity = remainingSupply;
        }
        if (numberMinted(msg.sender) + _quantity > maxPerAddressDuringMint) {
            revert Launchpeg__CanNotMintThisMany();
        }
        lastAuctionPrice = getAuctionPrice(auctionSaleStartTime);
        uint256 totalCost = lastAuctionPrice * _quantity;
        amountMintedDuringAuction = amountMintedDuringAuction + _quantity;
        _mint(msg.sender, _quantity, "", false);
        emit Mint(
            msg.sender,
            _quantity,
            lastAuctionPrice,
            _totalMinted() - _quantity,
            Phase.DutchAuction
        );
        _refundIfOver(totalCost);
    }

    /// @notice Mint NFTs during the allowlist mint
    /// @param _quantity Quantity of NFTs to mint
    function allowlistMint(uint256 _quantity)
        external
        payable
        override
        atPhase(Phase.Allowlist)
    {
        if (_quantity > allowlist[msg.sender]) {
            revert Launchpeg__NotEligibleForAllowlistMint();
        }
        uint256 remainingAuctionSupply = amountForAuction -
            amountMintedDuringAuction;
        if (
            totalSupply() + remainingAuctionSupply + _quantity >
            amountForAuction + amountForAllowlist + amountMintedByDevs
        ) {
            revert Launchpeg__MaxSupplyReached();
        }
        allowlist[msg.sender] -= _quantity;
        uint256 price = getAllowlistPrice();
        uint256 totalCost = price * _quantity;

        _mint(msg.sender, _quantity, "", false);
        amountMintedDuringAllowlist += _quantity;
        emit Mint(
            msg.sender,
            _quantity,
            price,
            _totalMinted() - _quantity,
            Phase.Allowlist
        );
        _refundIfOver(totalCost);
    }

    /// @notice Mint NFTs during the public sale
    /// @param _quantity Quantity of NFTs to mint
    function publicSaleMint(uint256 _quantity)
        external
        payable
        override
        atPhase(Phase.PublicSale)
    {
        if (
            totalSupply() + _quantity >
            collectionSize - (amountForDevs - amountMintedByDevs)
        ) {
            revert Launchpeg__MaxSupplyReached();
        }
        if (numberMinted(msg.sender) + _quantity > maxPerAddressDuringMint) {
            revert Launchpeg__CanNotMintThisMany();
        }
        uint256 price = getPublicSalePrice();

        _mint(msg.sender, _quantity, "", false);
        amountMintedDuringPublicSale += _quantity;
        emit Mint(
            msg.sender,
            _quantity,
            price,
            _totalMinted() - _quantity,
            Phase.PublicSale
        );
        _refundIfOver(price * _quantity);
    }

    /// @notice Returns the current price of the dutch auction
    /// @param _saleStartTime Auction sale start time
    /// @return auctionSalePrice Auction sale price
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

    /// @notice Returns the price of the allowlist mint
    /// @return allowlistSalePrice Mint List sale price
    function getAllowlistPrice() public view override returns (uint256) {
        return
            lastAuctionPrice -
            (lastAuctionPrice * allowlistDiscountPercent) /
            10000;
    }

    /// @notice Returns the price of the public sale
    /// @return publicSalePrice Public sale price
    function getPublicSalePrice() public view override returns (uint256) {
        return
            lastAuctionPrice -
            (lastAuctionPrice * publicSaleDiscountPercent) /
            10000;
    }

    /// @notice Returns the current phase
    /// @return phase Current phase
    function currentPhase() public view override returns (Phase) {
        if (
            auctionSaleStartTime == 0 ||
            allowlistStartTime == 0 ||
            publicSaleStartTime == 0 ||
            block.timestamp < auctionSaleStartTime
        ) {
            return Phase.NotStarted;
        } else if (
            block.timestamp >= auctionSaleStartTime &&
            block.timestamp < allowlistStartTime
        ) {
            return Phase.DutchAuction;
        } else if (
            block.timestamp >= allowlistStartTime &&
            block.timestamp < publicSaleStartTime
        ) {
            return Phase.Allowlist;
        }
        return Phase.PublicSale;
    }

    /// @dev Returns true if this contract implements the interface defined by
    /// `interfaceId`. See the corresponding
    /// https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[EIP section]
    /// to learn more about how these IDs are created.
    /// This function call must use less than 30 000 gas.
    /// @param _interfaceId InterfaceId to consider. Comes from type(InterfaceContract).interfaceId
    /// @return isInterfaceSupported True if the considered interface is supported
    function supportsInterface(bytes4 _interfaceId)
        public
        view
        virtual
        override(BaseLaunchpeg, IERC165Upgradeable)
        returns (bool)
    {
        return
            _interfaceId == type(ILaunchpeg).interfaceId ||
            super.supportsInterface(_interfaceId);
    }
}
