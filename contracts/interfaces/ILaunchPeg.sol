// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./IBaseLaunchPeg.sol";

/// @title ILaunchPeg
/// @author Trader Joe
/// @notice Defines the basic interface of LaunchPeg
interface ILaunchPeg is IBaseLaunchPeg {
    enum Phase {
        NotStarted,
        DutchAuction,
        Mintlist,
        PublicSale
    }

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

    /// @notice Amount of NFTs available for the auction (e.g 8000)
    /// Unsold items are put up for sale during the public sale.
    function amountForAuction() external view returns (uint256);

    /// @notice Amount of NFTs available for the allowlist mint (e.g 1000)
    /// Unsold items are put up for sale during the public sale.
    function amountForMintlist() external view returns (uint256);

    /// @notice Start time of the dutch auction in seconds
    /// @dev Timestamp
    function auctionSaleStartTime() external view returns (uint256);

    /// @notice Start time of the allowlist mint in seconds
    /// @dev A timestamp greater than the dutch auction start
    function mintlistStartTime() external view returns (uint256);

    /// @notice Start time of the public sale in seconds
    /// @dev A timestamp greater than the allowlist mint start
    function publicSaleStartTime() external view returns (uint256);

    /// @notice Auction start price in AVAX
    /// @dev auctionStartPrice is scaled to 1e18
    function auctionStartPrice() external view returns (uint256);

    /// @notice Auction floor price in AVAX
    /// @dev auctionEndPrice is scaled to 1e18
    function auctionEndPrice() external view returns (uint256);

    /// @notice Duration of the auction in seconds
    /// @dev auctionSaleStartTime - mintlistStartTime
    function auctionSaleDuration() external view returns (uint256);

    /// @notice Time elapsed between each drop in price
    /// @dev in seconds
    function auctionDropInterval() external view returns (uint256);

    /// @notice Amount in AVAX deducted at each interval
    function auctionDropPerStep() external view returns (uint256);

    /// @notice The discount applied to the last auction price during the allowlist mint
    /// @dev in basis points e.g 500 for 5%
    function mintlistDiscountPercent() external view returns (uint256);

    /// @notice The discount applied to the last auction price during the public sale
    /// @dev in basis points e.g 2500 for 25%
    function publicSaleDiscountPercent() external view returns (uint256);

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

    /// @notice Mint NFTs during the dutch auction
    /// The price decreases every `auctionDropInterval` by `auctionDropPerStep`
    /// @param _quantity Quantity of NFTs to buy
    function auctionMint(uint256 _quantity) external payable;

    /// @notice Mint NFTs during the allowlist mint
    /// @dev One NFT at a time
    function allowlistMint() external payable;

    /// @notice Returns the price of the allowlist mint
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
    function currentPhase() external view returns (Phase);
}
