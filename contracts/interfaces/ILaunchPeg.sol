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

    function amountForAuction() external view returns (uint256);

    function amountForMintlist() external view returns (uint256);

    function auctionSaleStartTime() external view returns (uint256);

    function mintlistStartTime() external view returns (uint256);

    function publicSaleStartTime() external view returns (uint256);

    function auctionStartPrice() external view returns (uint256);

    function auctionEndPrice() external view returns (uint256);

    function auctionSaleDuration() external view returns (uint256);

    function auctionDropInterval() external view returns (uint256);

    function auctionDropPerStep() external view returns (uint256);

    function mintlistDiscountPercent() external view returns (uint256);

    function publicSaleDiscountPercent() external view returns (uint256);

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

    function auctionMint(uint256 _quantity) external payable;

    function allowlistMint() external payable;

    function getMintlistPrice() external view returns (uint256);

    function publicSaleMint(uint256 _quantity) external payable;

    function getPublicSalePrice() external view returns (uint256);

    function getAuctionPrice(uint256 _saleStartTime)
        external
        view
        returns (uint256);

    function currentPhase() external view returns (Phase);
}
