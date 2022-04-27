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
/// @notice Implements a fair and gas efficient NFT launch mechanism. The sale takes place in 3 phases: dutch auction, allowList mint, public sale.
contract LaunchPeg is BaseLaunchPeg, ILaunchPeg {
    /// @notice Amount of NFTs available for the auction (e.g 8000)
    /// Unsold items are put up for sale during the public sale.
    uint256 public immutable override amountForAuction;

    /// @notice Amount of NFTs available for the allowList mint (e.g 1000)
    /// Unsold items are put up for sale during the public sale.
    uint256 public immutable override amountForMintlist;

    /// @notice Start time of the dutch auction in seconds
    /// @dev Timestamp
    uint256 public override auctionSaleStartTime;

    /// @notice Start time of the allowList mint in seconds
    /// @dev A timestamp greater than the dutch auction start
    uint256 public override mintlistStartTime;

    /// @notice Start time of the public sale in seconds
    /// @dev A timestamp greater than the allowList mint start
    uint256 public override publicSaleStartTime;

    /// @notice Auction start price in AVAX
    /// @dev auctionStartPrice is scaled to 1e18
    uint256 public override auctionStartPrice;

    /// @notice Auction floor price in AVAX
    /// @dev auctionEndPrice is scaled to 1e18
    uint256 public override auctionEndPrice;

    /// @notice Duration of the auction in seconds
    /// @dev mintlistStartTime - auctionSaleStartTime
    uint256 public override auctionSaleDuration;

    /// @notice Time elapsed between each drop in price
    /// @dev In seconds
    uint256 public override auctionDropInterval;

    /// @notice Amount in AVAX deducted at each interval
    uint256 public override auctionDropPerStep;

    /// @notice The discount applied to the last auction price during the allowList mint
    /// @dev In basis points e.g 500 for 5%
    uint256 public override mintlistDiscountPercent;

    /// @notice The discount applied to the last auction price during the public sale
    /// @dev In basis points e.g 2500 for 25%
    uint256 public override publicSaleDiscountPercent;

    /// @notice Tracks the amount of NFTs minted during the dutch auction
    uint256 public override amountMintedDuringAuction;

    /// @notice The price of the last NFT sold during the auction
    /// @dev lastAuctionPrice is scaled to 1e18
    uint256 public override lastAuctionPrice;

    /// @dev Emitted on initializePhases()
    /// @param name Contract name
    /// @param symbol Token symbol
    /// @param projectOwner Owner of the project
    /// @param maxBatchSize Max amount of NFTs that can be minted at once
    /// @param collectionSize The collection size (e.g 10000)
    /// @param amountForAuction Amount of NFTs available for the auction (e.g 8000)
    /// @param amountForMintlist Amount of NFTs available for the allowList mint (e.g 1000)
    /// @param amountForDevs Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @param auctionSaleStartTime Auction start time in seconds
    /// @param auctionStartPrice Auction start price in AVAX
    /// @param auctionEndPrice Auction floor price in AVAX
    /// @param auctionDropInterval Time elapsed between each drop in price in seconds
    /// @param mintlistStartTime Allowlist mint start time in seconds
    /// @param mintlistDiscountPercent Discount applied to the last auction price during the allowList mint
    /// @param publicSaleStartTime Public sale start time in seconds
    /// @param publicSaleDiscountPercent Discount applied to the last auction price during the public sale
    event Initialized(
        string indexed name,
        string indexed symbol,
        address indexed projectOwner,
        uint256 maxBatchSize,
        uint256 collectionSize,
        uint256 amountForAuction,
        uint256 amountForMintlist,
        uint256 amountForDevs,
        uint256 auctionSaleStartTime,
        uint256 auctionStartPrice,
        uint256 auctionEndPrice,
        uint256 auctionDropInterval,
        uint256 mintlistStartTime,
        uint256 mintlistDiscountPercent,
        uint256 publicSaleStartTime,
        uint256 publicSaleDiscountPercent
    );

    /// @dev Emitted on initializePhases()
    /// @param revealStartTime Start of the token URIs reveal in seconds
    /// @param revealInterval Interval between two batch reveals in seconds
    /// @param revealBatchSize Amount of NFTs revealed in a single batch
    event RevealInitialized(
        uint256 revealStartTime,
        uint256 revealInterval,
        uint256 revealBatchSize
    );

    /// @dev Emitted on auctionMint(), allowListMint(), publicSaleMint()
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
            revert LaunchPeg__WrongPhase();
        }
        _;
    }

    /// @dev LaunchPeg constructor
    /// @param _name ERC721 name
    /// @param _symbol ERC721 symbol
    /// @param _projectOwner The project owner
    /// @param _royaltyReceiver Royalty fee collector
    /// @param _maxBatchSize Max amount of NFTs that can be minted at once
    /// @param _collectionSize The collection size (e.g 10000)
    /// @param _amountForAuction Amount of NFTs available for the auction (e.g 8000)
    /// @param _amountForMintlist Amount of NFTs available for the allowList mint (e.g 1000)
    /// @param _amountForDevs Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @param _batchRevealSize Size of the batch reveal
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

    /// @notice Initialize the three phases of the sale
    /// @dev Can only be called once
    /// @param _auctionSaleStartTime Auction start time in seconds
    /// @param _auctionStartPrice Auction start price in AVAX
    /// @param _auctionEndPrice Auction floor price in AVAX
    /// @param _auctionDropInterval Time elapsed between each drop in price in seconds
    /// @param _mintlistStartTime Allowlist mint start time in seconds
    /// @param _mintlistDiscountPercent Discount applied to the last auction price during the allowList mint
    /// @param _publicSaleStartTime Public sale start time in seconds
    /// @param _publicSaleDiscountPercent Discount applied to the last auction price during the public sale
    /// @param _revealStartTime Start of the token URIs reveal in seconds
    /// @param _revealInterval Interval between two batch reveals in seconds
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
        if (_auctionDropInterval == 0) {
            revert LaunchPeg__InvalidAuctionDropInterval();
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

    /// @notice Mint NFTs during the dutch auction
    /// @dev The price decreases every `auctionDropInterval` by `auctionDropPerStep`
    /// @param _quantity Quantity of NFTs to buy
    function auctionMint(uint256 _quantity)
        external
        payable
        override
        isEOA
        atPhase(Phase.DutchAuction)
    {
        uint256 remainingSupply = (amountForAuction + _amountMintedByDevs) -
            totalSupply();
        if (remainingSupply == 0) {
            revert LaunchPeg__MaxSupplyReached();
        }
        if (remainingSupply < _quantity) {
            _quantity = remainingSupply;
        }
        if (numberMinted(msg.sender) + _quantity > maxPerAddressDuringMint) {
            revert LaunchPeg__CanNotMintThisMany();
        }
        lastAuctionPrice = getAuctionPrice(auctionSaleStartTime);
        uint256 totalCost = lastAuctionPrice * _quantity;
        _refundIfOver(totalCost);
        _mint(msg.sender, _quantity, "", false);
        amountMintedDuringAuction = amountMintedDuringAuction + _quantity;
        emit Mint(
            msg.sender,
            _quantity,
            lastAuctionPrice,
            _totalMinted() - _quantity,
            Phase.DutchAuction
        );
    }

    /// @notice Mint NFTs during the allowList mint
    /// @param _quantity Quantity of NFTs to mint
    function allowListMint(uint256 _quantity)
        external
        payable
        override
        isEOA
        atPhase(Phase.Mintlist)
    {
        if (_quantity > allowList[msg.sender]) {
            revert LaunchPeg__NotEligibleForAllowlistMint();
        }
        uint256 remainingAuctionSupply = amountForAuction -
            amountMintedDuringAuction;
        if (
            totalSupply() + remainingAuctionSupply + _quantity >
            amountForAuction + amountForMintlist + _amountMintedByDevs
        ) {
            revert LaunchPeg__MaxSupplyReached();
        }
        allowList[msg.sender] -= _quantity;
        uint256 price = getMintlistPrice();
        uint256 totalCost = price * _quantity;
        _refundIfOver(totalCost);
        _mint(msg.sender, _quantity, "", false);
        emit Mint(
            msg.sender,
            _quantity,
            price,
            _totalMinted() - _quantity,
            Phase.Mintlist
        );
    }

    /// @notice Mint NFTs during the public sale
    /// @param _quantity Quantity of NFTs to mint
    function publicSaleMint(uint256 _quantity)
        external
        payable
        override
        isEOA
        atPhase(Phase.PublicSale)
    {
        if (
            totalSupply() + _quantity >
            collectionSize - (amountForDevs - _amountMintedByDevs)
        ) {
            revert LaunchPeg__MaxSupplyReached();
        }
        if (numberMinted(msg.sender) + _quantity > maxPerAddressDuringMint) {
            revert LaunchPeg__CanNotMintThisMany();
        }
        uint256 price = getPublicSalePrice();
        _refundIfOver(price * _quantity);
        _mint(msg.sender, _quantity, "", false);
        emit Mint(
            msg.sender,
            _quantity,
            price,
            _totalMinted() - _quantity,
            Phase.PublicSale
        );
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

    /// @notice Returns the price of the allowList mint
    /// @return mintListSalePrice Mint List sale price
    function getMintlistPrice() public view override returns (uint256) {
        return
            lastAuctionPrice -
            (lastAuctionPrice * mintlistDiscountPercent) /
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
        override(BaseLaunchPeg, IERC165)
        returns (bool)
    {
        return
            _interfaceId == type(ILaunchPeg).interfaceId ||
            super.supportsInterface(_interfaceId);
    }
}
