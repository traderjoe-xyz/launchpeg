// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/// @title IBaseLaunchpeg
/// @author Trader Joe
/// @notice Defines the basic interface of BaseLaunchpeg
interface IBatchReveal {
    function initialize(
        uint256 _revealBatchSize,
        uint256 _collectionSize,
        uint256 _revealStartTime,
        uint256 _revealInterval
    ) external;

    function setRevealBatchSize(uint256 _revealBatchSize) external;

    function setRevealStartTime(uint256 _revealStartTime) external;

    function setRevealInterval(uint256 _revealInterval) external;

    function setVRF(
        address _vrfCoordinator,
        bytes32 _keyHash,
        uint64 _subscriptionId,
        uint32 _callbackGasLimit
    ) external;

    function revealBatchSize() external view returns (uint256);

    function batchToSeed(uint256) external view returns (uint256);

    function lastTokenRevealed() external view returns (uint256);

    function revealStartTime() external view returns (uint256);

    function revealInterval() external view returns (uint256);

    function useVRF() external view returns (bool);

    function subscriptionId() external view returns (uint64);

    function keyHash() external view returns (bytes32);

    function callbackGasLimit() external view returns (uint32);

    function requestConfirmations() external view returns (uint16);

    function nextBatchToReveal() external view returns (uint256);

    function hasBeenForceRevealed() external view returns (bool);

    function vrfRequestedForBatch(uint256) external view returns (bool);

    function getShuffledTokenId(uint256 _startId)
        external
        view
        returns (uint256);

    function isBatchRevealEnabled() external view returns (bool);

    function isBatchRevealInitialized() external view returns (bool);
}
