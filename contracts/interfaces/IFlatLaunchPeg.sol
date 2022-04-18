// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./IBaseLaunchPeg.sol";

/// @title ILaunchPeg
/// @author Trader Joe
/// @notice Defines the basic interface of FlatLaunchPeg
interface IFlatLaunchPeg is IBaseLaunchPeg {
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

    /// @notice Price of one NFT for people on the mint list
    /// @dev mintlistPrice is scaled to 1e18
    function mintlistPrice() external view returns (uint256);

    /// @notice Price of one NFT during the public sale
    /// @dev salePrice is scaled to 1e18
    function salePrice() external view returns (uint256);

    /// @notice Determine wether or not users are allowed to buy from public sale
    function isPublicSaleActive() external view returns (bool);

    /// @notice Mint NFTs during the allowlist mint
    /// @dev One NFT at a time
    function allowlistMint() external payable;

    /// @notice Mint NFTs during the public sale
    /// @param _quantity Quantity of NFTs to mint
    function publicSaleMint(uint256 _quantity) external payable;

    /// @notice Switch the sale on and off
    /// @dev Must be only owner
    /// @param _isPublicSaleActive Whether or not the public sale is open
    function setPublicSaleActive(bool _isPublicSaleActive) external;
}
