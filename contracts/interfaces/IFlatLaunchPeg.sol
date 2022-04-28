// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./IBaseLaunchpeg.sol";

/// @title ILaunchpeg
/// @author Trader Joe
/// @notice Defines the basic interface of FlatLaunchpeg
interface IFlatLaunchpeg is IBaseLaunchpeg {
    function mintlistPrice() external view returns (uint256);

    function salePrice() external view returns (uint256);

    function isPublicSaleActive() external view returns (bool);

    function allowListMint(uint256 _quantity) external payable;

    function publicSaleMint(uint256 _quantity) external payable;

    function setPublicSaleActive(bool _isPublicSaleActive) external;
}
