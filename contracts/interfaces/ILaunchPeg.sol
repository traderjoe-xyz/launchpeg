// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "erc721a/contracts/ERC721A.sol";
import "../LaunchPeg.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";

/// @title ILaunchPeg
/// @author Trader Joe
/// @notice Defines the basic interface of LaunchPeg
interface ILaunchPeg is IERC721, IERC721Metadata {
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
    /// @param revealStartTime Start of the token URIs reveal in seconds
    /// @param revealInterval Interval between two batch reveals in seconds
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
        uint256 publicSaleDiscountPercent,
        uint256 revealStartTime,
        uint256 revealInterval
    );

    /// @dev Emitted on initializeJoeFee()
    /// @param feePercent The fees collected by Joepeg on the sale benefits
    /// @param feeCollector The address to which the fees on the sale will be sent
    event JoeFeeInitialized(uint256 feePercent, address feeCollector);

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
        LaunchPeg.Phase phase
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
    ) external;

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

    /// @notice Mint NFTs during the dutch auction
    /// The price decreases every `auctionDropInterval` by `auctionDropPerStep`
    /// @param _quantity Quantity of NFTs to buy
    function auctionMint(uint256 _quantity) external payable;

    /// @notice Mint NFTs during the allowlist mint
    /// @dev One NFT at a time
    function allowlistMint() external payable;

    function getMintlistPrice() external view returns (uint256);

    /// @notice Mint NFTs during the public sale
    /// @param _quantity Quantity of NFTs to mint
    function publicSaleMint(uint256 _quantity) external payable;

    /// @notice Returns the price of the public sale
    function getPublicSalePrice() external view returns (uint256);

    /// @notice Returns the current price of the dutch auction
    function getAuctionPrice(uint256 _saleStartTime)
        external
        view
        returns (uint256);

    /// @notice Returns the current phase
    function currentPhase() external view returns (LaunchPeg.Phase);

    /// @notice Set the project owner
    /// @dev The project owner can call `devMint` any time
    function setProjectOwner(address _projectOwner) external;

    /// @notice Mint NFTs to the project owner
    /// @dev Can only mint up to ``amountForDevs`
    /// @param quantity Quantity of NFTs to mint
    function devMint(uint256 quantity) external;

    /// @notice Set the base URI
    /// @dev Only callable by project owner
    function setBaseURI(string calldata baseURI) external;

    /// @notice Set the unrevealed URI
    /// @dev Only callable by project owner
    function setUnrevealedURI(string calldata baseURI) external;

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

    /// @notice Checks block timestamp, token minted and last token revealed
    function hasBatchToReveal() external view returns (bool, uint256);

    /// @notice Reveals the next batch if the reveal conditions are met
    function revealNextBatch() external;

    /// @notice Allows ProjectOwner to reveal batches even if the conditions are not met
    function forceReveal() external;
}
