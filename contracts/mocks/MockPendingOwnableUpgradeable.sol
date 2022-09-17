// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../utils/PendingOwnableUpgradeable.sol";

/// @title Mock contract using `PendingOwnableUpgradeable`
/// @author Trader Joe
contract MockPendingOwnableUpgradeable is
    Initializable,
    PendingOwnableUpgradeable
{
    function initialize() public initializer {
        __PendingOwnable_init();
    }
}
