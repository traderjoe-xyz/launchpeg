//SPDX-License-Identifier: CC0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";

import "./chainlink/VRFConsumerBaseV2Upgradeable.sol";
import "./interfaces/IBatchReveal.sol";
import "./LaunchpegErrors.sol";

// Creator: Tubby Cats
/// https://github.com/tubby-cats/batch-nft-reveal

/// @title BatchReveal
/// @notice Implements a gas efficient way of revealing NFT URIs gradually
abstract contract BatchReveal is
    IBatchReveal,
    VRFConsumerBaseV2Upgradeable,
    Initializable
{
    /// @dev Initialized on parent contract creation
    uint256 private collectionSize;
    int128 private intCollectionSize;

    /// @notice Size of the batch reveal
    /// @dev Must divide collectionSize
    uint256 public override revealBatchSize;

    /// @notice Randomized seeds used to shuffle TokenURIs
    mapping(uint256 => uint256) public override batchToSeed;

    /// @notice Last token that has been revealed
    uint256 public override lastTokenRevealed = 0;

    /// @dev Size of the array that will store already taken URIs numbers
    uint256 private _rangeLength;

    /// @notice Timestamp for the start of the reveal process
    /// @dev Can be set to zero for immediate reveal after token mint
    uint256 public override revealStartTime;

    /// @notice Time interval for gradual reveal
    /// @dev Can be set to zero in order to reveal the collection all at once
    uint256 public override revealInterval;

    /// @notice Contract uses VRF or pseudo-randomness
    bool public override useVRF;

    /// @notice Chainlink subscription ID
    uint64 public override subscriptionId;

    /// @notice The gas lane to use, which specifies the maximum gas price to bump to.
    /// For a list of available gas lanes on each network,
    /// see https://docs.chain.link/docs/vrf-contracts/#configurations
    bytes32 public override keyHash;

    /// @notice Depends on the number of requested values that you want sent to the
    /// fulfillRandomWords() function. Storing each word costs about 20,000 gas,
    /// so 100,000 is a safe default for this example contract. Test and adjust
    /// this limit based on the network that you select, the size of the request,
    /// and the processing of the callback request in the fulfillRandomWords()
    /// function.
    uint32 public override callbackGasLimit;

    /// @notice Number of block confirmations that the coordinator will wait before triggering the callback
    /// The default is 3
    uint16 public constant override requestConfirmations = 3;

    /// @notice Next batch that will be revealed by VRF, if activated
    uint256 public override nextBatchToReveal;

    /// @notice Has a batch been force revealed
    /// @dev VRF will not be used anymore if a batch has been force revealed
    bool public override hasBeenForceRevealed;

    /// @notice Has the random number for a batch already been asked
    /// @dev Prevents people from spamming the random words request
    /// and therefore reveal more batches than expected
    mapping(uint256 => bool) public override vrfRequestedForBatch;

    struct Range {
        int128 start;
        int128 end;
    }

    /// @dev Emitted on revealNextBatch() and forceReveal()
    /// @param batchNumber The batch revealed
    /// @param batchSeed The random number drawn
    event Reveal(uint256 batchNumber, uint256 batchSeed);

    /// @dev BatchReveal initialization
    /// @param _revealBatchSize Size of the batch reveal
    /// @param _collectionSize Needs to be sent by child contract
    function initializeBatchReveal(
        uint256 _revealBatchSize,
        uint256 _collectionSize
    ) internal onlyInitializing {
        if (
            _collectionSize % _revealBatchSize != 0 ||
            _revealBatchSize == 0 ||
            _revealBatchSize > _collectionSize
        ) {
            revert Launchpeg__InvalidBatchRevealSize();
        }
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
        for (uint256 j; j < _lastIndex; j++) {
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
        uint256 lastIndex;
        for (uint256 i; i < _lastBatch; i++) {
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
        int128 id;

        for (uint256 round = 0; round < 2; round++) {
            for (uint256 i; i < _rangeLength; i++) {
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
    /// @return hasToRevealInfo Returns a bool saying whether a reveal can be triggered or not
    /// and the number of the next batch that will be revealed
    function _hasBatchToReveal(uint256 _totalSupply)
        internal
        view
        returns (bool, uint256)
    {
        uint256 batchNumber;
        unchecked {
            batchNumber = lastTokenRevealed / revealBatchSize;
        }

        // We don't want to reveal other batches if a VRF random words request is pending
        if (
            block.timestamp < revealStartTime + batchNumber * revealInterval ||
            _totalSupply < lastTokenRevealed + revealBatchSize ||
            vrfRequestedForBatch[batchNumber]
        ) {
            return (false, batchNumber);
        }

        return (true, batchNumber);
    }

    /// @dev Reveals next batch if possible
    /// @dev If using VRF, the reveal happens on the coordinator callback call
    /// @param _totalSupply Number of token already minted
    /// @return isRevealed Returns false if it is not possible to reveal the next batch
    function _revealNextBatch(uint256 _totalSupply) internal returns (bool) {
        uint256 batchNumber;
        bool canReveal;
        (canReveal, batchNumber) = _hasBatchToReveal(_totalSupply);

        if (!canReveal) {
            return false;
        }

        if (useVRF) {
            VRFCoordinatorV2Interface(vrfCoordinator).requestRandomWords(
                keyHash,
                subscriptionId,
                requestConfirmations,
                callbackGasLimit,
                1
            );
            vrfRequestedForBatch[batchNumber] = true;
        } else {
            lastTokenRevealed += revealBatchSize;
            _setBatchSeed(batchNumber);
            emit Reveal(batchNumber, batchToSeed[batchNumber]);
        }

        return true;
    }

    /// @dev Callback triggered by the VRF coordinator
    /// @param _randomWords Array of random numbers provided by the VRF coordinator
    function fulfillRandomWords(
        uint256, /* requestId */
        uint256[] memory _randomWords
    ) internal override {
        if (hasBeenForceRevealed) {
            revert Launchpeg__HasBeenForceRevealed();
        }

        uint256 _batchToReveal = nextBatchToReveal++;
        uint256 _revealBatchSize = revealBatchSize;
        uint256 _seed = _randomWords[0] %
            (collectionSize - (_batchToReveal * _revealBatchSize));

        batchToSeed[_batchToReveal] = _seed;
        lastTokenRevealed += _revealBatchSize;

        emit Reveal(_batchToReveal, batchToSeed[_batchToReveal]);
    }

    /// @dev Force reveal, should be restricted to owner
    function _forceReveal() internal {
        uint256 batchNumber;
        unchecked {
            batchNumber = lastTokenRevealed / revealBatchSize;
            lastTokenRevealed += revealBatchSize;
        }

        _setBatchSeed(batchNumber);
        hasBeenForceRevealed = true;
        emit Reveal(batchNumber, batchToSeed[batchNumber]);
    }
}
