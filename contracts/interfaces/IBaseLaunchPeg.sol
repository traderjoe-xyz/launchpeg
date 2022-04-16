// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";

import "erc721a/contracts/ERC721A.sol";

/// @title IBaseLaunchPeg
/// @author Trader Joe
/// @notice Defines the basic interface of BaseLaunchPeg
interface IBaseLaunchPeg is IERC721, IERC721Metadata {
    /// @dev Emitted on initializeJoeFee()
    /// @param feePercent The fees collected by Joepeg on the sale benefits
    /// @param feeCollector The address to which the fees on the sale will be sent
    event JoeFeeInitialized(uint256 feePercent, address feeCollector);

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
    function initializeJoeFee(
        uint256 _joeFeePercent,
        address payable _joeFeeCollector
    ) external;

    /// @notice Seed the allowlist: each address can mint up to numSlot
    /// @dev e.g _addresses: [0x1, 0x2, 0x3], _numSlots: [1, 1, 2]
    /// @param _addresses Addresses allowed to mint during the allowlist phase
    /// @param _numSlots Quantity of NFTs that an address can mint
    function seedAllowlist(
        address[] memory _addresses,
        uint256[] memory _numSlots
    ) external;

    /// @notice Set the project owner
    /// @dev The project owner can call `devMint` any time
    function setProjectOwner(address _projectOwner) external;

    /// @notice Mint NFTs to the project owner
    /// @dev Can only mint up to ``amountForDevs`
    /// @param quantity Quantity of NFTs to mint
    function devMint(uint256 quantity) external;

    /// @notice Withdraw money to the contract owner
    function withdrawMoney() external;

    /// @notice Returns the number of NFTs minted by a specific address
    /// @param owner The owner of the NFTs
    function numberMinted(address owner) external view returns (uint256);

    /// @notice Returns the ownership data of a specific token ID
    /// @param tokenId Token ID
    function getOwnershipData(uint256 tokenId)
        external
        view
        returns (ERC721A.TokenOwnership memory);

    /// @notice Set the base URI
    /// @dev Only callable by project owner
    function setBaseURI(string calldata baseURI) external;

    /// @notice Set the unrevealed URI
    /// @dev Only callable by project owner
    function setUnrevealedURI(string calldata baseURI) external;

    /// @notice Set the royalty fee
    /// @param receiver Royalty fee collector
    /// @param feePercent Royalty fee percent in basis point
    function setRoyaltyInfo(address receiver, uint96 feePercent) external;

    /// @notice Checks block timestamp, token minted and last token revealed
    function hasBatchToReveal() external view returns (bool, uint256);

    /// @notice Reveals the next batch if the reveal conditions are met
    function revealNextBatch() external;

    /// @notice Allows ProjectOwner to reveal batches even if the conditions are not met
    function forceReveal() external;
}
