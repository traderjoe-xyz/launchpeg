//SPDX-License-Identifier: CC0
pragma solidity ^0.8.4;

import "./interfaces/IBatchReveal.sol";

// Creator: Tubby Cats
/// https://github.com/tubby-cats/batch-nft-reveal

/// @title BatchReveal
/// @notice Implements a gas efficient way of revealing NFT URIs gradually
abstract contract BatchReveal is IBatchReveal {
    /// @dev Initialized on parent contract creation
    uint256 private immutable collectionSize;
    int128 private immutable intCollectionSize;

    /// @inheritdoc IBatchReveal
    uint256 public immutable override revealBatchSize;

    /// @inheritdoc IBatchReveal
    mapping(uint256 => uint256) public override batchToSeed;

    /// @inheritdoc IBatchReveal
    uint256 public override lastTokenRevealed = 0;

    /// @dev Size of the array that will store already taken URIs numbers
    uint256 private immutable _rangeLength;

    /// @inheritdoc IBatchReveal
    uint256 public override revealStartTime;

    /// @inheritdoc IBatchReveal
    uint256 public override revealInterval;

    struct Range {
        int128 start;
        int128 end;
    }

    /// @dev Emitted on revealNextBatch() and forceReveal()
    /// @param batchNumber The batch revealed
    /// @param batchSeed The random number drawn
    event Reveal(uint256 batchNumber, uint256 batchSeed);

    /// @dev BatchReveal constructor
    /// @param _revealBatchSize Size of the batch reveal
    /// @param _collectionSize Needs to be sent by child contract
    constructor(uint256 _revealBatchSize, uint256 _collectionSize) {
        revealBatchSize = _revealBatchSize;
        collectionSize = _collectionSize;
        _rangeLength = (_collectionSize / _revealBatchSize) * 2;
        intCollectionSize = int128(int256(_collectionSize));
    }

    // Forked from openzeppelin
    /// @dev Returns the smallest of two numbers.
    /// @param _a First number to consider
    /// @param _b Second number to consider
    /// @return min Minimum between the two params
    function _min(int128 _a, int128 _b) internal pure returns (int128) {
        return _a < _b ? _a : _b;
    }

    /// @notice Fills the range array
    /// @dev Ranges include the start but not the end [start, end)
    /// @param _ranges initial range array
    /// @param _start beginning of the array to be added
    /// @param _end end of the array to be added
    /// @param _lastIndex last position in the range array to consider
    /// @return newLastIndex new lastIndex to consider for the future range to be added
    function _addRange(
        Range[] memory _ranges,
        int128 _start,
        int128 _end,
        uint256 _lastIndex
    ) private view returns (uint256) {
        uint256 positionToAssume = _lastIndex;
        for (uint256 j = 0; j < _lastIndex; j++) {
            int128 rangeStart = _ranges[j].start;
            int128 rangeEnd = _ranges[j].end;
            if (_start < rangeStart && positionToAssume == _lastIndex) {
                positionToAssume = j;
            }
            if (
                (_start < rangeStart && _end > rangeStart) ||
                (rangeStart <= _start && _end <= rangeEnd) ||
                (_start < rangeEnd && _end > rangeEnd)
            ) {
                int128 length = _end - _start;
                _start = _min(_start, rangeStart);
                _end = _start + length + (rangeEnd - rangeStart);
                _ranges[j] = Range(-1, -1); // Delete
            }
        }
        for (uint256 pos = _lastIndex; pos > positionToAssume; pos--) {
            _ranges[pos] = _ranges[pos - 1];
        }
        _ranges[positionToAssume] = Range(
            _start,
            _min(_end, intCollectionSize)
        );
        _lastIndex++;
        if (_end > intCollectionSize) {
            _addRange(_ranges, 0, _end - intCollectionSize, _lastIndex);
            _lastIndex++;
        }
        return _lastIndex;
    }

    /// @dev Adds the last batch into the ranges array
    /// @param _lastBatch Batch number to consider
    /// @return ranges Ranges array filled with every URI taken by batches smaller or equal to lastBatch
    function _buildJumps(uint256 _lastBatch)
        private
        view
        returns (Range[] memory)
    {
        Range[] memory ranges = new Range[](_rangeLength);
        uint256 lastIndex = 0;
        for (uint256 i = 0; i < _lastBatch; i++) {
            int128 start = int128(
                int256(_getFreeTokenId(batchToSeed[i], ranges))
            );
            int128 end = start + int128(int256(revealBatchSize));
            lastIndex = _addRange(ranges, start, end, lastIndex);
        }
        return ranges;
    }

    /// @dev Gets the random token URI number from tokenId
    /// @param _startId Token Id to consider
    /// @return uriId Revealed Token URI Id
    function _getShuffledTokenId(uint256 _startId)
        internal
        view
        returns (uint256)
    {
        uint256 batch = _startId / revealBatchSize;
        Range[] memory ranges = new Range[](_rangeLength);

        ranges = _buildJumps(batch);

        uint256 positionsToMove = (_startId % revealBatchSize) +
            batchToSeed[batch];

        return _getFreeTokenId(positionsToMove, ranges);
    }

    /// @dev Gets the shifted URI number from tokenId and range array
    /// @param _positionsToMoveStart Token URI offset if none of the URI Ids were taken
    /// @param _ranges Ranges array built by _buildJumps()
    /// @return uriId Revealed Token URI Id
    function _getFreeTokenId(
        uint256 _positionsToMoveStart,
        Range[] memory _ranges
    ) private view returns (uint256) {
        int128 positionsToMove = int128(int256(_positionsToMoveStart));
        int128 id = 0;

        for (uint256 round = 0; round < 2; round++) {
            for (uint256 i = 0; i < _rangeLength; i++) {
                int128 start = _ranges[i].start;
                int128 end = _ranges[i].end;
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
    /// @param _batchNumber Batch number that needs to be revealed
    function _setBatchSeed(uint256 _batchNumber) internal {
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
        batchToSeed[_batchNumber] =
            randomness %
            (collectionSize - (_batchNumber * revealBatchSize));
    }

    /// @dev Returns true if a batch can be revealed
    /// @param _totalSupply Number of token already minted
    /// @return hasToRevealInfo Returns a bool saying wether a reveal can be triggered or not
    /// And the number of the next batch that will be revealed
    function _hasBatchToReveal(uint256 _totalSupply)
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
            _totalSupply < lastTokenRevealed + revealBatchSize
        ) {
            return (false, batchNumber);
        }

        return (true, batchNumber);
    }

    /// @dev Reveals next batch if possible
    /// @param _totalSupply Number of token already minted
    ///@return isRevealed Returns false if it is not possible to reveal the next batch
    function _revealNextBatch(uint256 _totalSupply) internal returns (bool) {
        uint256 batchNumber;
        bool canReveal;
        (canReveal, batchNumber) = _hasBatchToReveal(_totalSupply);

        if (!canReveal) {
            return false;
        }

        lastTokenRevealed += revealBatchSize;
        _setBatchSeed(batchNumber);

        emit Reveal(batchNumber, batchToSeed[batchNumber]);
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
        emit Reveal(batchNumber, batchToSeed[batchNumber]);
    }
}
