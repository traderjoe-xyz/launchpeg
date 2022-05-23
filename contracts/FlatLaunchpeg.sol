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
    /// @param allowlistStartTime Allowlist mint start time in seconds
    /// @param publicSaleStartTime Public sale start time in seconds
    /// @param allowlistPrice Price of the allowlist sale in Avax
    /// @param salePrice Price of the public sale in Avax
    event Initialized(
        uint256 allowlistStartTime,
        uint256 publicSaleStartTime,
        uint256 allowlistPrice,
        uint256 salePrice
    );

    /// @dev Emitted on allowlistMint(), publicSaleMint()
    /// @param sender The address that minted
    /// @param quantity Amount of NFTs minted
    /// @param price Price in AVAX for the NFTs
    /// @param tokenId The token ID of the first minted NFT
    event Mint(
        address indexed sender,
        uint256 quantity,
        uint256 price,
        uint256 tokenId
    );

    /// @dev Emitted on setPublicSaleActive()
    /// @param isActive True if the public sale is open, false otherwise
    event PublicSaleStateChanged(bool isActive);

    modifier atPhase(Phase _phase) {
        if (currentPhase() != _phase) {
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
        uint256 _amountForDevs,
        uint256 _amountForAllowlist,
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
    }

    /// @notice Initialize the two phases of the sale
    /// @dev Can only be called once
    /// @param _allowlistStartTime Allowlist mint start time in seconds
    /// @param _publicSaleStartTime Public sale start time in seconds
    /// @param _allowlistPrice Price of the allowlist sale in Avax
    /// @param _salePrice Price of the public sale in Avax
    function initializePhases(
        uint256 _allowlistStartTime,
        uint256 _publicSaleStartTime,
        uint256 _allowlistPrice,
        uint256 _salePrice
    ) external override onlyOwner atPhase(Phase.NotStarted) {
        if (allowlistStartTime != 0) {
            revert Launchpeg__PhasesAlreadyInitialized();
        }
        if (_allowlistStartTime < block.timestamp) {
            revert Launchpeg__InvalidStartTime();
        }
        if (_publicSaleStartTime <= _allowlistStartTime) {
            revert Launchpeg__PublicSaleBeforeAllowlist();
        }
        if (_allowlistPrice > _salePrice) {
            revert Launchpeg__InvalidAllowlistPrice();
        }

        salePrice = _salePrice;
        allowlistPrice = _allowlistPrice;

        allowlistStartTime = _allowlistStartTime;
        publicSaleStartTime = _publicSaleStartTime;

        emit Initialized(
            allowlistStartTime,
            publicSaleStartTime,
            allowlistPrice,
            salePrice
        );
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
        if (
            totalSupply() + _quantity > collectionSize ||
            amountMintedDuringAllowlist + _quantity > amountForAllowlist
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
            _totalMinted() - _quantity
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
        if (numberMinted(msg.sender) + _quantity > maxPerAddressDuringMint) {
            revert Launchpeg__CanNotMintThisMany();
        }
        if (totalSupply() + _quantity > collectionSize) {
            revert Launchpeg__MaxSupplyReached();
        }
        uint256 total = salePrice * _quantity;

        _mint(msg.sender, _quantity, "", false);
        amountMintedDuringPublicSale += _quantity;
        emit Mint(msg.sender, _quantity, salePrice, _totalMinted() - _quantity);
        _refundIfOver(total);
    }

    /// @notice Returns the current phase
    /// @return phase Current phase
    function currentPhase() public view override returns (Phase) {
        if (
            allowlistStartTime == 0 ||
            publicSaleStartTime == 0 ||
            block.timestamp < allowlistStartTime
        ) {
            return Phase.NotStarted;
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
}
