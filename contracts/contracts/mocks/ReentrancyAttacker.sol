// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TimelockVault} from "../TimelockVault.sol";

/// @notice Solo para tests: intenta volver a retirar mientras recibe los ETH del primer retiro.
contract ReentrancyAttacker {
    TimelockVault public immutable vault;
    uint256 public vaultId;
    uint256 public sharedVaultId;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(TimelockVault vault_) {
        vault = vault_;
    }

    function createVault(uint64 unlockTime) external payable {
        vaultId = vault.createVault{value: msg.value}("ataque", unlockTime);
    }

    function attack() external {
        vault.withdraw(vaultId);
    }

    function createSharedVault(address partner, uint64 unlockTime) external {
        sharedVaultId = vault.createSharedVault("ataque", partner, unlockTime);
    }

    function depositShared() external payable {
        vault.depositShared{value: msg.value}(sharedVaultId);
    }

    function approveShared() external {
        vault.approveWithdrawal(sharedVaultId);
    }

    function attackShared() external {
        vault.withdrawShared(sharedVaultId);
    }

    receive() external payable {
        if (reentryAttempted) return;
        reentryAttempted = true;
        if (sharedVaultId != 0) {
            try vault.withdrawShared(sharedVaultId) {
                reentrySucceeded = true;
            } catch {}
        } else {
            try vault.withdraw(vaultId) {
                reentrySucceeded = true;
            } catch {}
        }
    }
}
