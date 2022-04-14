//SPDX-License-Identifier: CC0
pragma solidity ^0.8.4;

// Creator: Tubby Cats
/// https://github.com/tubby-cats/batch-nft-reveal

/// @title BatchReveal
/// @notice Implements a gas efficient way of revealing NFT URIs gradually
abstract contract BatchReveal {
    /// @dev Initialized on parent contract creation
    uint256 private immutable collectionSize;
    int128 private immutable intCollectionSize;

    /// @notice Size of the batch reveal
    /// @dev Must divide collectionSize
    uint256 public immutable revealBatchSize;

    /// @notice Randomized seeds used to shuffle TokenURIs
    mapping(uint256 => uint256) public batchToSeed;

    /// @notice Last token that has been revealed
    uint256 public lastTokenRevealed = 0;

    /// @dev Size of the array that will store already taken URIs numbers
    uint256 private immutable rangeLength;

    /// @notice Timestamp for the start of the reveal process
    /// @dev Can be set to zero for immediate reveal after token mint
    uint256 public revealStartTime;

    /// @notice Time interval for gradual reveal
    /// @dev Can be set to zero in order to reveal the collection all at once
    uint256 public revealInterval;

    struct Range {
        int128 start;
        int128 end;
    }

    constructor(uint256 _revealBatchSize, uint256 _collectionSize) {
        revealBatchSize = _revealBatchSize;
        collectionSize = _collectionSize;
        rangeLength = (_collectionSize / _revealBatchSize) * 2;
        intCollectionSize = int128(int256(_collectionSize));
    }

    // Forked from openzeppelin
    /// @dev Returns the smallest of two numbers.
    function min(int128 a, int128 b) internal pure returns (int128) {
        return a < b ? a : b;
    }

    /// @dev Fills the range array
    /// ranges include the start but not the end [start, end)
    function _addRange(
        Range[] memory ranges,
        int128 start,
        int128 end,
        uint256 lastIndex
    ) private view returns (uint256) {
        uint256 positionToAssume = lastIndex;
        for (uint256 j = 0; j < lastIndex; j++) {
            int128 rangeStart = ranges[j].start;
            int128 rangeEnd = ranges[j].end;
            if (start < rangeStart && positionToAssume == lastIndex) {
                positionToAssume = j;
            }
            if (
                (start < rangeStart && end > rangeStart) ||
                (rangeStart <= start && end <= rangeEnd) ||
                (start < rangeEnd && end > rangeEnd)
            ) {
                int128 length = end - start;
                start = min(start, rangeStart);
                end = start + length + (rangeEnd - rangeStart);
                ranges[j] = Range(-1, -1); // Delete
            }
        }
        for (uint256 pos = lastIndex; pos > positionToAssume; pos--) {
            ranges[pos] = ranges[pos - 1];
        }
        ranges[positionToAssume] = Range(start, min(end, intCollectionSize));
        lastIndex++;
        if (end > intCollectionSize) {
            _addRange(ranges, 0, end - intCollectionSize, lastIndex);
            lastIndex++;
        }
        return lastIndex;
    }

    /// @dev Adds the last bast into the ranges array
    function _buildJumps(uint256 lastBatch)
        private
        view
        returns (Range[] memory)
    {
        Range[] memory ranges = new Range[](rangeLength);
        uint256 lastIndex = 0;
        for (uint256 i = 0; i < lastBatch; i++) {
            int128 start = int128(
                int256(_getFreeTokenId(batchToSeed[i], ranges))
            );
            int128 end = start + int128(int256(revealBatchSize));
            lastIndex = _addRange(ranges, start, end, lastIndex);
        }
        return ranges;
    }

    /// @dev Gets the random token URI number from tokenId
    function _getShuffledTokenId(uint256 startId)
        internal
        view
        returns (uint256)
    {
        uint256 batch = startId / revealBatchSize;
        Range[] memory ranges = new Range[](rangeLength);

        ranges = _buildJumps(batch);

        uint256 positionsToMove = (startId % revealBatchSize) +
            batchToSeed[batch];

        return _getFreeTokenId(positionsToMove, ranges);
    }

    /// @dev Gets the shifted URI number from tokenId and range array
    function _getFreeTokenId(
        uint256 positionsToMoveStart,
        Range[] memory ranges
    ) private view returns (uint256) {
        int128 positionsToMove = int128(int256(positionsToMoveStart));
        int128 id = 0;

        for (uint256 round = 0; round < 2; round++) {
            for (uint256 i = 0; i < rangeLength; i++) {
                int128 start = ranges[i].start;
                int128 end = ranges[i].end;
                if (id < start) {
                    int128 finalId = id + positionsToMove;
                    if (finalId < start) {
                        return uint256(uint128(finalId));
                    } else {
                        positionsToMove -= start - id;
                        id = end;
                    }
                } else if (id < end) {
                    id = end;
                }
            }
            if ((id + positionsToMove) >= intCollectionSize) {
                positionsToMove -= intCollectionSize - id;
                id = 0;
            }
        }
        return uint256(uint128(id + positionsToMove));
    }

    /// @dev Sets batch seed for specified batch number
    function _setBatchSeed(uint256 batchNumber) internal {
        uint256 randomness = uint256(
            keccak256(
                abi.encode(
                    msg.sender,
                    tx.gasprice,
                    block.number,
                    block.timestamp,
                    block.difficulty,
                    blockhash(block.number - 1),
                    address(this)
                )
            )
        );

        // not perfectly random since the folding doesn't match bounds perfectly, but difference is small
        batchToSeed[batchNumber] =
            randomness %
            (collectionSize - (batchNumber * revealBatchSize));
    }

    /// @dev Returns true if a batch can be revealed
    function _hasBatchToReveal(uint256 totalSupply)
        internal
        view
        returns (bool, uint256)
    {
        uint256 batchNumber;
        unchecked {
            batchNumber = lastTokenRevealed / revealBatchSize;
        }

        if (
            block.timestamp < revealStartTime + batchNumber * revealInterval ||
            totalSupply < lastTokenRevealed + revealBatchSize
        ) {
            return (false, batchNumber);
        }

        return (true, batchNumber);
    }

    /// @dev Reveals next batch if possible
    function _revealNextBatch(uint256 totalSupply) internal returns (bool) {
        uint256 batchNumber;
        bool canReveal;
        (canReveal, batchNumber) = _hasBatchToReveal(totalSupply);

        if (!canReveal) {
            return false;
        }

        lastTokenRevealed += revealBatchSize;
        _setBatchSeed(batchNumber);

        return true;
    }

    /// @dev Force reveal, should be restricted to owner
    function _forceReveal() internal {
        uint256 batchNumber;
        unchecked {
            batchNumber = lastTokenRevealed / revealBatchSize;
            lastTokenRevealed += revealBatchSize;
        }

        _setBatchSeed(batchNumber);
    }
}
