// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TimelockVault} from "../TimelockVault.sol";

/// @notice Solo para tests: un titular que no puede recibir ETH, para probar transferencias fallidas.
contract RejectingReceiver {
    TimelockVault public immutable vault;
    uint256 public vaultId;

    constructor(TimelockVault vault_) {
        vault = vault_;
    }

    function createVault(uint64 unlockTime) external payable {
        vaultId = vault.createVault{value: msg.value}("rechaza", unlockTime);
    }

    function withdraw() external {
        vault.withdraw(vaultId);
    }

    receive() external payable {
        revert("no acepto ETH");
    }
}
