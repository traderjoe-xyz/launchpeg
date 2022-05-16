// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/// @title ILaunchpegFactory
/// @author Trader Joe
/// @notice Defines the basic interface of LaunchpegFactory
interface ILaunchpegFactory {
    struct BatchReveal {
        uint256 batchRevealSize;
        uint256 revealStartTime;
        uint256 revealInterval;
    }

    event LaunchpegCreated(
        address indexed launchpeg,
        string name,
        string symbol,
        address indexed projectOwner,
        address indexed royaltyReceiver,
        uint256 maxBatchSize,
        uint256 collectionSize,
        uint256 amountForAuction,
        uint256 amountForMintlist,
        uint256 amountForDevs,
        uint256 batchRevealSize,
        uint256 revealStartTime,
        uint256 revealInterval
    );

    event FlatLaunchpegCreated(
        address indexed flatLaunchpeg,
        string name,
        string symbol,
        address indexed projectOwner,
        address indexed royaltyReceiver,
        uint256 maxBatchSize,
        uint256 collectionSize,
        uint256 amountForDevs,
        uint256 salePrice,
        uint256 mintlistPrice,
        uint256 batchRevealSize,
        uint256 revealStartTime,
        uint256 revealInterval
    );

    event SetLaunchpegImplementation(address indexed launchpegImplementation);
    event SetFlatLaunchpegImplementation(
        address indexed flatLaunchpegImplementation
    );
    event SetDefaultJoeFeePercent(uint256 joeFeePercent);
    event SetDefaultJoeFeeCollector(address indexed joeFeeCollector);

    function launchpegImplementation() external view returns (address);

    function flatLaunchpegImplementation() external view returns (address);

    function joeFeePercent() external view returns (uint256);

    function joeFeeCollector() external view returns (address);

    function isLaunchpeg(uint256 _type, address _contract)
        external
        view
        returns (bool);

    function allLaunchpegs(uint256 _launchpegType, uint256 _launchpegID)
        external
        view
        returns (address);

    function numLaunchpegs(uint256 _launchpegType)
        external
        view
        returns (uint256);

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
        BatchReveal calldata _batchRevealData
    ) external returns (address);

    function createFlatLaunchpeg(
        string memory _name,
        string memory _symbol,
        address _projectOwner,
        address _royaltyReceiver,
        uint256 _maxBatchSize,
        uint256 _collectionSize,
        uint256 _amountForDevs,
        uint256 _salePrice,
        uint256 _mintlistPrice,
        BatchReveal calldata _batchRevealData
    ) external returns (address);

    function setLaunchpegImplementation(address _launchpegImplementation)
        external;

    function setFlatLaunchpegImplementation(
        address _flatLaunchpegImplementation
    ) external;

    function setDefaultJoeFeePercent(uint256 _joeFeePercent) external;

    function setDefaultJoeFeeCollector(address _joeFeeCollector) external;
}
