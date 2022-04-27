// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./IBaseLaunchPeg.sol";

/// @title ILaunchPeg
/// @author Trader Joe
/// @notice Defines the basic interface of FlatLaunchPeg
interface IFlatLaunchPeg is IBaseLaunchPeg {
    function mintlistPrice() external view returns (uint256);

    function salePrice() external view returns (uint256);

    function isPublicSaleActive() external view returns (bool);

    function allowListMint(uint256 _quantity) external payable;

    function publicSaleMint(uint256 _quantity) external payable;

    function setPublicSaleActive(bool _isPublicSaleActive) external;
}
