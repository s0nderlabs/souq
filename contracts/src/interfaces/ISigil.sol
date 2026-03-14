// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

interface ISigil {
    function isCompliant(address wallet, bytes32 policyId) external view returns (bool);
}
