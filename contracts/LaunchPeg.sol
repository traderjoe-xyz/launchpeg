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
    uint256 public immutable override amountForAuction;

    /// @notice Amount of NFTs available for the allowlist mint (e.g 1000)
    /// Unsold items are put up for sale during the public sale.
    uint256 public immutable override amountForMintlist;

    /// @dev Tracks the amount of NFTs minted during the dutch auction
    uint256 private amountMintedDuringAuction;

    /// @notice Start time of the dutch auction in seconds
    /// @dev Timestamp
    uint256 public override auctionSaleStartTime;

    /// @notice Start time of the allowlist mint in seconds
    /// @dev A timestamp greater than the dutch auction start
    uint256 public override mintlistStartTime;

    /// @notice Start time of the public sale in seconds
    /// @dev A timestamp greater than the allowlist mint start
    uint256 public override publicSaleStartTime;

    /// @notice Auction start price in AVAX
    /// @dev auctionStartPrice is scaled to 1e18
    uint256 public override auctionStartPrice;

    /// @notice Auction floor price in AVAX
    /// @dev auctionEndPrice is scaled to 1e18
    uint256 public override auctionEndPrice;

    /// @notice Duration of the auction in seconds
    /// @dev auctionSaleStartTime - mintlistStartTime
    uint256 public override auctionSaleDuration;

    /// @notice Time elapsed between each drop in price
    /// @dev in seconds
    uint256 public override auctionDropInterval;

    /// @notice Amount in AVAX deducted at each interval
    uint256 public override auctionDropPerStep;

    /// @notice The price of the last NFT sold during the auction
    /// @dev lastAuctionPrice is scaled to 1e18
    uint256 private lastAuctionPrice;

    /// @notice The discount applied to the last auction price during the allowlist mint
    /// @dev in basis points e.g 500 for 5%
    uint256 public override mintlistDiscountPercent;

    /// @notice The discount applied to the last auction price during the public sale
    /// @dev in basis points e.g 2500 for 25%
    uint256 public override publicSaleDiscountPercent;

    /// @dev Emitted on initializePhases()
    /// @param name Contract name
    /// @param symbol Token symbol
    /// @param projectOwner Owner of the project
    /// @param maxBatchSize  Max amout of NFTs that can be minted at once
    /// @param collectionSize The collection size (e.g 10000)
    /// @param amountForAuction Amount of NFTs available for the auction (e.g 8000)
    /// @param amountForMintlist  Amount of NFTs available for the allowlist mint (e.g 1000)
    /// @param amountForDevs Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @param auctionSaleStartTime Auction start time in seconds
    /// @param auctionStartPrice Auction start price in AVAX
    /// @param auctionEndPrice Auction floor price in AVAX
    /// @param auctionDropInterval Time elapsed between each drop in price in seconds
    /// @param mintlistStartTime Allowlist mint start time in seconds
    /// @param mintlistDiscountPercent Discount applied to the last auction price during the allowlist mint
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
            revert LaunchPeg__WrongPhase();
        }
        _;
    }

    /// @dev LaunchPeg constructor
    /// @param _name ERC721 name
    /// @param _symbol ERC721 symbol
    /// @param _projectOwner The project owner
    /// @param _royaltyReceiver Royalty fee collector
    /// @param _maxBatchSize Max amout of NFTs that can be minted at once
    /// @param _collectionSize The collection size (e.g 10000)
    /// @param _amountForAuction Amount of NFTs available for the auction (e.g 8000)
    /// @param _amountForMintlist Amount of NFTs available for the allowlist mint (e.g 1000)
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
    /// @param _mintlistDiscountPercent Discount applied to the last auction price during the allowlist mint
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
    /// The price decreases every `auctionDropInterval` by `auctionDropPerStep`
    /// @param _quantity Quantity of NFTs to buy
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
        _mint(msg.sender, _quantity, '', false);
        amountMintedDuringAuction = amountMintedDuringAuction + _quantity;
        emit Mint(
            msg.sender,
            _quantity,
            lastAuctionPrice,
            _totalMinted() - _quantity,
            Phase.DutchAuction
        );
    }

    /// @notice Mint NFTs during the allowlist mint
    /// @dev One NFT at a time
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
        _mint(msg.sender, 1, '', false);
        emit Mint(msg.sender, 1, price, _totalMinted() - 1, Phase.Mintlist);
    }

    /// @notice Returns the price of the allowlist mint
    function getMintlistPrice() public view override returns (uint256) {
        return
            lastAuctionPrice -
            (lastAuctionPrice * mintlistDiscountPercent) /
            10000;
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
            collectionSize - (amountForDevs - amountMintedByDevs)
        ) {
            revert LaunchPeg__MaxSupplyReached();
        }
        if (numberMinted(msg.sender) + _quantity > maxPerAddressDuringMint) {
            revert LaunchPeg__CanNotMintThisMany();
        }
        uint256 price = getPublicSalePrice();
        refundIfOver(price * _quantity);
        _mint(msg.sender, _quantity, '', false);
        emit Mint(
            msg.sender,
            _quantity,
            price,
            _totalMinted() - _quantity,
            Phase.PublicSale
        );
    }

    /// @notice Returns the price of the public sale
    function getPublicSalePrice() public view override returns (uint256) {
        return
            lastAuctionPrice -
            (lastAuctionPrice * publicSaleDiscountPercent) /
            10000;
    }

    /// @notice Returns the current price of the dutch auction
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

    /// @notice Returns the current phase
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
    /// to learn more about how these ids are created.
    /// This function call must use less than 30 000 gas.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(BaseLaunchPeg, IERC165)
        returns (bool)
    {
        return
            interfaceId == type(ILaunchPeg).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
