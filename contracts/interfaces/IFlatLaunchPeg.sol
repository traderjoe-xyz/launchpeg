// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";

/// @title ILaunchPeg
/// @author Trader Joe
/// @notice Defines the basic interface of LaunchPeg
interface IFlatLaunchPeg is IERC721, IERC721Metadata {
    /// @dev Emitted on initializeJoeFee()
    /// @param feePercent The fees collected by Joepeg on the sale benefits
    /// @param feeCollector The address to which the fees on the sale will be sent
    event JoeFeeInitialized(uint256 feePercent, address feeCollector);

    /// @dev Emitted on auctionMint(), allowlistMint(), publicSaleMint()
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

    /// @dev Emitted on devMint()
    /// @param sender The address that minted
    /// @param quantity Amount of NFTs minted
    event DevMint(address indexed sender, uint256 quantity);

    /// @dev Emitted on withdrawMoney()
    /// @param sender The address that withdrew the tokens
    /// @param amount Amount of AVAX transfered to `sender`
    /// @param fee Amount of AVAX paid to the fee collector
    event MoneyWithdraw(address indexed sender, uint256 amount, uint256 fee);

    /// @dev Emitted on setProjectOwner()
    /// @param owner The new project owner
    event ProjectOwnerUpdated(address indexed owner);

    /// @notice Initialize the percentage taken on the sale and collector address
    /// @param _joeFeePercent The fees collected by Joepeg on the sale benefits
    /// @param _joeFeeCollector The address to which the fees on the sale will be sent
    function initializeJoeFee(uint256 _joeFeePercent, address _joeFeeCollector)
        external;

    /// @notice Seed the allowlist: each address can mint up to numSlot
    /// @dev e.g _addresses: [0x1, 0x2, 0x3], _numSlots: [1, 1, 2]
    /// @param _addresses Addresses allowed to mint during the allowlist phase
    /// @param _numSlots Quantity of NFTs that an address can mint
    function seedAllowlist(
        address[] memory _addresses,
        uint256[] memory _numSlots
    ) external;

    /// @notice Mint NFTs to the project owner
    /// @dev Can only mint up to ``amountForDevs`
    /// @param quantity Quantity of NFTs to mint
    function devMint(uint256 quantity) external;

    /// @notice Mint NFTs during the allowlist mint
    /// @dev One NFT at a time
    function allowlistMint() external payable;

    /// @notice Mint NFTs during the public sale
    /// @param _quantity Quantity of NFTs to mint
    function publicSaleMint(uint256 _quantity) external payable;

    /// @notice Set the project owner
    /// @dev The project owner can call `devMint` any time
    function setProjectOwner(address _projectOwner) external;

    /// @notice Set the base URI
    function setBaseURI(string calldata baseURI) external;

    /// @notice Withdraw money to the contract owner
    function withdrawMoney() external;

    /// @notice Switch the sale on and off
    /// @dev Must be only owner
    function flipSaleState() external;

    /// @notice number of NFT minted
    function totalSupply() external view returns (uint256);
}
