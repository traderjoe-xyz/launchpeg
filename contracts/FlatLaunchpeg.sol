// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./interfaces/IFlatLaunchpeg.sol";
import "./BaseLaunchpeg.sol";

/// @title FlatLaunchpeg
/// @author Trader Joe
/// @notice Implements a simple minting NFT contract with an allowlist and public sale phase.
contract FlatLaunchpeg is BaseLaunchpeg, IFlatLaunchpeg {
    /// @notice Price of one NFT for people on the mint list
    /// @dev allowlistPrice is scaled to 1e18
    uint256 public override allowlistPrice;

    /// @notice Price of one NFT during the public sale
    /// @dev salePrice is scaled to 1e18
    uint256 public override salePrice;

    /// @dev Emitted on initializePhases()
    /// @param preMintStartTime Pre-mint start time in seconds
    /// @param allowlistStartTime Allowlist mint start time in seconds
    /// @param publicSaleStartTime Public sale start time in seconds
    /// @param publicSaleEndTime Public sale end time in seconds
    /// @param allowlistPrice Price of the allowlist sale in Avax
    /// @param salePrice Price of the public sale in Avax
    event Initialized(
        uint256 preMintStartTime,
        uint256 allowlistStartTime,
        uint256 publicSaleStartTime,
        uint256 publicSaleEndTime,
        uint256 allowlistPrice,
        uint256 salePrice
    );

    modifier atPhase(Phase _phase) {
        if (currentPhase() != _phase) {
            revert Launchpeg__WrongPhase();
        }
        _;
    }

    /// @dev Batch mint is allowed in the allowlist and public sale phases
    modifier isBatchMintAvailable() {
        Phase currPhase = currentPhase();
        if (currPhase != Phase.Allowlist && currPhase != Phase.PublicSale) {
            revert Launchpeg__WrongPhase();
        }
        _;
    }

    /// @notice FlatLaunchpeg initialization
    /// Can only be called once
    /// @param _name ERC721 name
    /// @param _symbol ERC721 symbol
    /// @param _projectOwner The project owner
    /// @param _royaltyReceiver Royalty fee collector
    /// @param _maxBatchSize Max amount of NFTs that can be minted at once
    /// @param _collectionSize The collection size (e.g 10000)
    /// @param _amountForDevs Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @param _amountForAllowlist Amount of NFTs available for the allowlist mint (e.g 1000)
    function initialize(
        string memory _name,
        string memory _symbol,
        address _projectOwner,
        address _royaltyReceiver,
        uint256 _maxBatchSize,
        uint256 _collectionSize,
        uint256 _amountForDevs,
        uint256 _amountForAllowlist
    ) external override initializer {
        initializeBaseLaunchpeg(
            _name,
            _symbol,
            _projectOwner,
            _royaltyReceiver,
            _maxBatchSize,
            _collectionSize,
            _amountForDevs,
            _amountForAllowlist
        );
    }

    /// @notice Initialize the two phases of the sale
    /// @dev Can only be called once
    /// @param _preMintStartTime Pre-mint start time in seconds
    /// @param _allowlistStartTime Allowlist mint start time in seconds
    /// @param _publicSaleStartTime Public sale start time in seconds
    /// @param _publicSaleEndTime Public sale end time in seconds
    /// @param _allowlistPrice Price of the allowlist sale in Avax
    /// @param _salePrice Price of the public sale in Avax
    function initializePhases(
        uint256 _preMintStartTime,
        uint256 _allowlistStartTime,
        uint256 _publicSaleStartTime,
        uint256 _publicSaleEndTime,
        uint256 _allowlistPrice,
        uint256 _salePrice
    ) external override onlyOwner atPhase(Phase.NotStarted) {
        if (_preMintStartTime < block.timestamp) {
            revert Launchpeg__InvalidStartTime();
        }
        if (_allowlistStartTime < _preMintStartTime) {
            revert Launchpeg__AllowlistBeforePreMint();
        }
        if (_publicSaleStartTime < _allowlistStartTime) {
            revert Launchpeg__PublicSaleBeforeAllowlist();
        }
        if (_publicSaleEndTime < _publicSaleStartTime) {
            revert Launchpeg__PublicSaleEndBeforePublicSaleStart();
        }
        if (_allowlistPrice > _salePrice) {
            revert Launchpeg__InvalidAllowlistPrice();
        }

        salePrice = _salePrice;
        allowlistPrice = _allowlistPrice;

        preMintStartTime = _preMintStartTime;
        allowlistStartTime = _allowlistStartTime;
        publicSaleStartTime = _publicSaleStartTime;
        publicSaleEndTime = _publicSaleEndTime;

        emit Initialized(
            preMintStartTime,
            allowlistStartTime,
            publicSaleStartTime,
            publicSaleEndTime,
            allowlistPrice,
            salePrice
        );
    }

    /// @notice Set the pre-mint start time. Can only be set after phases
    /// have been initialized.
    /// @dev Only callable by owner
    /// @param _preMintStartTime New pre-mint start time
    function setPreMintStartTime(uint256 _preMintStartTime)
        external
        override
        onlyOwner
    {
        if (preMintStartTime == 0) {
            revert Launchpeg__NotInitialized();
        }
        if (_preMintStartTime < block.timestamp) {
            revert Launchpeg__InvalidStartTime();
        }
        if (allowlistStartTime < _preMintStartTime) {
            revert Launchpeg__AllowlistBeforePreMint();
        }
        preMintStartTime = _preMintStartTime;
        emit PreMintStartTimeSet(_preMintStartTime);
    }

    /// @notice Mint NFTs during the pre-mint
    /// @param _quantity Quantity of NFTs to mint
    function preMint(uint256 _quantity)
        external
        payable
        override
        whenNotPaused
        atPhase(Phase.PreMint)
    {
        _preMint(_quantity);
    }

    /// @notice Batch mint NFTs requested during the pre-mint
    /// @param _maxQuantity Max quantity of NFTs to mint
    function batchMintPreMintedNFTs(uint256 _maxQuantity)
        external
        override
        whenNotPaused
        isBatchMintAvailable
    {
        _batchMintPreMintedNFTs(_maxQuantity);
    }

    /// @notice Mint NFTs during the allowlist mint
    /// @param _quantity Quantity of NFTs to mint
    function allowlistMint(uint256 _quantity)
        external
        payable
        override
        whenNotPaused
        atPhase(Phase.Allowlist)
    {
        if (_quantity > allowlist[msg.sender]) {
            revert Launchpeg__NotEligibleForAllowlistMint();
        }
        if (
            (_totalSupplyWithPreMint() + _quantity > collectionSize) ||
            (amountMintedDuringPreMint +
                amountMintedDuringAllowlist +
                _quantity) >
            amountForAllowlist
        ) {
            revert Launchpeg__MaxSupplyReached();
        }
        allowlist[msg.sender] -= _quantity;
        uint256 totalCost = allowlistPrice * _quantity;

        _mint(msg.sender, _quantity, "", false);
        amountMintedDuringAllowlist += _quantity;
        emit Mint(
            msg.sender,
            _quantity,
            allowlistPrice,
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
        isEOA
        whenNotPaused
        atPhase(Phase.PublicSale)
    {
        if (
            numberMintedWithPreMint(msg.sender) + _quantity >
            maxPerAddressDuringMint
        ) {
            revert Launchpeg__CanNotMintThisMany();
        }
        if (_totalSupplyWithPreMint() + _quantity > collectionSize) {
            revert Launchpeg__MaxSupplyReached();
        }
        uint256 total = salePrice * _quantity;

        _mint(msg.sender, _quantity, "", false);
        amountMintedDuringPublicSale += _quantity;
        emit Mint(
            msg.sender,
            _quantity,
            salePrice,
            _totalMinted() - _quantity,
            Phase.PublicSale
        );
        _refundIfOver(total);
    }

    /// @notice Returns the current phase
    /// @return phase Current phase
    function currentPhase() public view override returns (Phase) {
        if (
            preMintStartTime == 0 ||
            allowlistStartTime == 0 ||
            publicSaleStartTime == 0 ||
            publicSaleEndTime == 0 ||
            block.timestamp < preMintStartTime
        ) {
            return Phase.NotStarted;
        } else if (totalSupply() >= collectionSize) {
            return Phase.Ended;
        } else if (
            block.timestamp >= preMintStartTime &&
            block.timestamp < allowlistStartTime
        ) {
            return Phase.PreMint;
        } else if (
            block.timestamp >= allowlistStartTime &&
            block.timestamp < publicSaleStartTime
        ) {
            return Phase.Allowlist;
        } else if (
            block.timestamp >= publicSaleStartTime &&
            block.timestamp < publicSaleEndTime
        ) {
            return Phase.PublicSale;
        }
        return Phase.Ended;
    }

    /// @dev Returns true if this contract implements the interface defined by
    /// `interfaceId`. See the corresponding
    /// https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[EIP section]
    /// to learn more about how these IDs are created.
    /// This function call must use less than 30 000 gas.
    /// @param _interfaceId InterfaceId to consider. Comes from type(Interface).interfaceId
    /// @return isInterfaceSupported True if the considered interface is supported
    function supportsInterface(bytes4 _interfaceId)
        public
        view
        virtual
        override(BaseLaunchpeg, IERC165Upgradeable)
        returns (bool)
    {
        return
            _interfaceId == type(IFlatLaunchpeg).interfaceId ||
            super.supportsInterface(_interfaceId);
    }

    /// @dev Returns pre-mint price. Used by _preMint() and _batchMintPreMintedNFTs() methods.
    function _preMintPrice() internal view override returns (uint256) {
        return allowlistPrice;
    }
}
