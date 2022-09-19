// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "../utils/SafePausableUpgradeable.sol";

/// @title Mock contract using `SafePausableUpgradeable`
/// @author Trader Joe
contract MockSafePausableUpgradeable is SafePausableUpgradeable {
    uint256 shh;

    function initialize() external initializer {
        __SafePausable_init();
    }

    function pausableFunction() external whenNotPaused {
        shh = shh;
    }

    function doSomething() external {
        shh = shh;
    }
}
