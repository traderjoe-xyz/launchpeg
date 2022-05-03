// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/// @title ILaunchpegFactory
/// @author Trader Joe
/// @notice Defines the basic interface of LaunchpegFactory
interface ILaunchpegFactory {
    function launchpegImplementation() external view returns (address);

    function flatLaunchpegImplementation() external view returns (address);

    function joeFeePercent() external view returns (uint256);

    function joeFeeCollector() external view returns (address);

    function isLaunchpeg(address _contract) external view returns (bool);

    function allLaunchpegs(uint256 _launchpegID)
        external
        view
        returns (address);

    function numLaunchpegs() external view returns (uint256);

    function createLaunchpeg(
        string memory _name,
        string memory _symbol,
        address _projectOwner,
        address _royaltyReceiver,
        uint256 _maxBatchSize,
        uint256 _collectionSize,
        uint256 _amountForAuction,
        uint256 _amountForMintlist,
        uint256 _amountForDevs,
        uint256 _batchRevealSize
    ) external returns (address);

    function createFlatLaunchpeg(
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
    ) external returns (address);

    function setLaunchpegImplementation(address _launchpegImplementation)
        external;

    function setFlatLaunchpegImplementation(
        address _flatLaunchpegImplementation
    ) external;

    function setDefaultJoeFeePercent(uint256 _joeFeePercent) external;

    function setDefaultJoeFeeCollector(address _joeFeeCollector) external;
}
