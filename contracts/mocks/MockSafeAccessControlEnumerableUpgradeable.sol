// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "../utils/SafeAccessControlEnumerableUpgradeable.sol";

/// @title Mock contract using `SafeAccessControlEnumerableUpgradeable`
/// @author Trader Joe
contract MockSafeAccessControlEnumerableUpgradeable is
    SafeAccessControlEnumerableUpgradeable
{
    function initialize() external initializer {
        __SafeAccessControlEnumerable_init();
    }

    function setRoleAdmin(bytes32 role, bytes32 adminRole) external onlyOwner {
        _setRoleAdmin(role, adminRole);
    }
}
