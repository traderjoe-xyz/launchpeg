// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/// @title IBaseLaunchPeg
/// @author Trader Joe
/// @notice Defines the basic interface of BaseLaunchPeg
interface IBatchReveal {
    /// @notice Size of the batch reveal
    /// @dev Must divide collectionSize
    function revealBatchSize() external view returns (uint256);

    /// @notice Randomized seeds used to shuffle TokenURIs
    function batchToSeed(uint256) external view returns (uint256);

    /// @notice Last token that has been revealed
    function lastTokenRevealed() external view returns (uint256);

    /// @notice Timestamp for the start of the reveal process
    /// @dev Can be set to zero for immediate reveal after token mint
    function revealStartTime() external view returns (uint256);

    /// @notice Time interval for gradual reveal
    /// @dev Can be set to zero in order to reveal the collection all at once
    function revealInterval() external view returns (uint256);
}
