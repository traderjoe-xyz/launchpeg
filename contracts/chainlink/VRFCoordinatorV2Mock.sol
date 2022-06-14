// SPDX-License-Identifier: MIT
// A mock for testing code that relies on VRFCoordinatorV2.
// Forked from chainlink/contracts/src/v0.8/mocks/VRFCoordinatorV2Mock.sol
pragma solidity ^0.8.4;

import "./VRFConsumerBaseV2Upgradeable.sol";

contract VRFCoordinatorV2Mock {
    uint96 public immutable BASE_FEE;
    uint96 public immutable GAS_PRICE_LINK;

    bytes32[] public keyHashList;
    address[] public consumers;

    error InvalidSubscription();
    error InsufficientBalance();
    error MustBeSubOwner(address owner);

    event RandomWordsRequested(
        bytes32 indexed keyHash,
        uint256 requestId,
        uint256 preSeed,
        uint64 indexed subId,
        uint16 minimumRequestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords,
        address indexed sender
    );
    event RandomWordsFulfilled(
        uint256 indexed requestId,
        uint256 outputSeed,
        uint96 payment,
        bool success
    );
    event SubscriptionCreated(uint64 indexed subId, address owner);
    event SubscriptionFunded(
        uint64 indexed subId,
        uint256 oldBalance,
        uint256 newBalance
    );
    event SubscriptionCanceled(
        uint64 indexed subId,
        address to,
        uint256 amount
    );

    uint64 s_currentSubId;
    uint256 s_nextRequestId = 1;
    uint256 s_nextPreSeed = 100;
    struct Subscription {
        address owner;
        uint96 balance;
    }
    mapping(uint64 => Subscription) s_subscriptions; /* subId */ /* subscription */

    struct Request {
        uint64 subId;
        uint32 callbackGasLimit;
        uint32 numWords;
    }
    mapping(uint256 => Request) s_requests; /* requestId */ /* request */

    constructor(uint96 _baseFee, uint96 _gasPriceLink) {
        BASE_FEE = _baseFee;
        GAS_PRICE_LINK = _gasPriceLink;
    }

    /**
     * @notice fulfillRandomWords fulfills the given request, sending the random words to the supplied
     * @notice consumer.
     *
     * @dev This mock uses a simplified formula for calculating payment amount and gas usage, and does
     * @dev not account for all edge cases handled in the real VRF coordinator. When making requests
     * @dev against the real coordinator a small amount of additional LINK is required.
     *
     * @param _requestId the request to fulfill
     * @param _consumer the VRF randomness consumer to send the result to
     */
    function fulfillRandomWords(uint256 _requestId, address _consumer)
        external
    {
        uint256 startGas = gasleft();
        if (s_requests[_requestId].subId == 0) {
            revert("nonexistent request");
        }
        Request memory req = s_requests[_requestId];

        uint256[] memory words = new uint256[](req.numWords);
        for (uint256 i = 0; i < req.numWords; i++) {
            words[i] = uint256(keccak256(abi.encode(_requestId, i)));
        }

        VRFConsumerBaseV2Upgradeable v;
        bytes memory callReq = abi.encodeWithSelector(
            v.rawFulfillRandomWords.selector,
            _requestId,
            words
        );
        (bool success, ) = _consumer.call{gas: req.callbackGasLimit}(callReq);

        uint96 payment = uint96(
            BASE_FEE + ((startGas - gasleft()) * GAS_PRICE_LINK)
        );
        if (s_subscriptions[req.subId].balance < payment) {
            revert InsufficientBalance();
        }
        s_subscriptions[req.subId].balance -= payment;
        delete (s_requests[_requestId]);
        emit RandomWordsFulfilled(_requestId, _requestId, payment, success);
    }

    /**
     * @notice fundSubscription allows funding a subscription with an arbitrary amount for testing.
     *
     * @param _subId the subscription to fund
     * @param _amount the amount to fund
     */
    function fundSubscription(uint64 _subId, uint96 _amount) public {
        if (s_subscriptions[_subId].owner == address(0)) {
            revert InvalidSubscription();
        }
        uint96 oldBalance = s_subscriptions[_subId].balance;
        s_subscriptions[_subId].balance += _amount;
        emit SubscriptionFunded(_subId, oldBalance, oldBalance + _amount);
    }

    function requestRandomWords(
        bytes32 _keyHash,
        uint64 _subId,
        uint16 _minimumRequestConfirmations,
        uint32 _callbackGasLimit,
        uint32 _numWords
    ) external returns (uint256) {
        if (s_subscriptions[_subId].owner == address(0)) {
            revert InvalidSubscription();
        }

        uint256 requestId = s_nextRequestId++;
        uint256 preSeed = s_nextPreSeed++;

        s_requests[requestId] = Request({
            subId: _subId,
            callbackGasLimit: _callbackGasLimit,
            numWords: _numWords
        });

        emit RandomWordsRequested(
            _keyHash,
            requestId,
            preSeed,
            _subId,
            _minimumRequestConfirmations,
            _callbackGasLimit,
            _numWords,
            msg.sender
        );
        return requestId;
    }

    function createSubscription() external returns (uint64 _subId) {
        s_currentSubId++;
        s_subscriptions[s_currentSubId] = Subscription({
            owner: msg.sender,
            balance: 0
        });
        emit SubscriptionCreated(s_currentSubId, msg.sender);
        return s_currentSubId;
    }

    function getSubscription(uint64 _subId)
        external
        view
        returns (
            uint96 balance,
            uint64 reqCount,
            address owner,
            address[] memory consumersList
        )
    {
        if (s_subscriptions[_subId].owner == address(0)) {
            revert InvalidSubscription();
        }
        return (
            s_subscriptions[_subId].balance,
            0,
            s_subscriptions[_subId].owner,
            consumers
        );
    }

    function cancelSubscription(uint64 _subId, address _to)
        external
        onlySubOwner(_subId)
    {
        emit SubscriptionCanceled(_subId, _to, s_subscriptions[_subId].balance);
        delete (s_subscriptions[_subId]);
    }

    modifier onlySubOwner(uint64 _subId) {
        address owner = s_subscriptions[_subId].owner;
        if (owner == address(0)) {
            revert InvalidSubscription();
        }
        if (msg.sender != owner) {
            revert MustBeSubOwner(owner);
        }
        _;
    }

    function getRequestConfig()
        external
        view
        returns (
            uint16,
            uint32,
            bytes32[] memory
        )
    {
        return (3, 2000000, keyHashList);
    }

    function addKeyHash(bytes32 _newKeyHash) external {
        keyHashList.push(_newKeyHash);
    }

    function addConsumer(uint64 _subId, address _consumer) external {
        _subId;
        consumers.push(_consumer);
    }

    function removeConsumer(uint64 _subId, address _consumer) external {
        _subId;
        _consumer;
        consumers.pop();
    }

    function requestSubscriptionOwnerTransfer(uint64 _subId, address _newOwner)
        external
        pure
    {
        _subId;
        _newOwner;
        revert("not implemented");
    }

    function acceptSubscriptionOwnerTransfer(uint64 _subId) external pure {
        _subId;
        revert("not implemented");
    }
}
