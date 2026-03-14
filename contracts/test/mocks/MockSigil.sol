// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

contract MockSigil {
    mapping(address => mapping(bytes32 => bool)) public compliance;

    function setCompliance(address wallet, bytes32 policyId, bool compliant_) external {
        compliance[wallet][policyId] = compliant_;
    }

    function isCompliant(address wallet, bytes32 policyId) external view returns (bool) {
        return compliance[wallet][policyId];
    }
}
