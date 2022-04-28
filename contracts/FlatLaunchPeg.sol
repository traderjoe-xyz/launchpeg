// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./LaunchpegErrors.sol";
import "./interfaces/IFlatLaunchpeg.sol";
import "./BaseLaunchpeg.sol";

/// @title FlatLaunchpeg
/// @author Trader Joe
/// @notice Implements a simple minting NFT contract with an allowList and public sale phase.
contract FlatLaunchpeg is BaseLaunchpeg, IFlatLaunchpeg {
    /// @notice Price of one NFT for people on the mint list
    /// @dev mintlistPrice is scaled to 1e18
    uint256 public immutable override mintlistPrice;

    /// @notice Price of one NFT during the public sale
    /// @dev salePrice is scaled to 1e18
    uint256 public immutable override salePrice;

    /// @notice Determine wether or not users are allowed to buy from public sale
    bool public override isPublicSaleActive = false;

    /// @dev Emitted on allowListMint(), publicSaleMint()
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

    /// @dev FlatLaunchpeg constructor
    /// @param _name ERC721 name
    /// @param _symbol ERC721 symbol
    /// @param _projectOwner The project owner
    /// @param _royaltyReceiver Royalty fee collector
    /// @param _maxBatchSize Max amount of NFTs that can be minted at once
    /// @param _collectionSize The collection size (e.g 10000)
    /// @param _amountForDevs Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @param _batchRevealSize Size of the batch reveal
    /// @param _salePrice Price of the public sale in Avax
    /// @param _mintlistPrice Price of the whitelist sale in Avax
    constructor(
        string memory _name,
        string memory _symbol,
        address _projectOwner,
        address _royaltyReceiver,
        uint256 _maxBatchSize,
        uint256 _collectionSize,
        uint256 _amountForDevs,
        uint256 _batchRevealSize,
        uint256 _salePrice,
        uint256 _mintlistPrice
    )
        BaseLaunchpeg(
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
        salePrice = _salePrice;
        mintlistPrice = _mintlistPrice;
    }

    /// @notice Switch the sale on and off
    /// @dev Must be only owner
    /// @param _isPublicSaleActive Whether or not the public sale is open
    function setPublicSaleActive(bool _isPublicSaleActive)
        external
        override
        onlyOwner
    {
        isPublicSaleActive = _isPublicSaleActive;
        emit PublicSaleStateChanged(_isPublicSaleActive);
    }

    /// @notice Mint NFTs during the allowList mint
    /// @param _quantity Quantity of NFTs to mint
    function allowListMint(uint256 _quantity) external payable override {
        if (_quantity > allowList[msg.sender]) {
            revert Launchpeg__NotEligibleForAllowlistMint();
        }
        if (totalSupply() + _quantity > collectionSize) {
            revert Launchpeg__MaxSupplyReached();
        }
        allowList[msg.sender] -= _quantity;
        uint256 totalCost = mintlistPrice * _quantity;
        _refundIfOver(totalCost);
        _mint(msg.sender, _quantity, "", false);
        emit Mint(
            msg.sender,
            _quantity,
            mintlistPrice,
            _totalMinted() - _quantity
        );
    }

    /// @notice Mint NFTs during the public sale
    /// @param _quantity Quantity of NFTs to mint
    function publicSaleMint(uint256 _quantity) external payable override {
        if (!isPublicSaleActive) {
            revert Launchpeg__PublicSaleClosed();
        }
        if (_quantity > maxPerAddressDuringMint) {
            revert Launchpeg__CanNotMintThisMany();
        }
        if (totalSupply() + _quantity > collectionSize) {
            revert Launchpeg__MaxSupplyReached();
        }
        uint256 total = salePrice * _quantity;
        _refundIfOver(total);
        _mint(msg.sender, _quantity, "", false);
        emit Mint(msg.sender, _quantity, total, _totalMinted() - _quantity);
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
        override(BaseLaunchpeg, IERC165)
        returns (bool)
    {
        return
            _interfaceId == type(IFlatLaunchpeg).interfaceId ||
            super.supportsInterface(_interfaceId);
    }
}
