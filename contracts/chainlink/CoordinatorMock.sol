// SPDX-License-Identifier: MIT
// A mock for testing code that relies on VRFCoordinatorV2.
pragma solidity ^0.8.4;

import "@chainlink/contracts/src/v0.8/mocks/VRFCoordinatorV2Mock.sol";

contract CoordinatorMock is VRFCoordinatorV2Mock {
    constructor(uint96 _baseFee, uint96 _gasPriceLink)
        VRFCoordinatorV2Mock(_baseFee, _gasPriceLink)
    {}
}
