// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "../src/AgenticJobEscrow.sol";
import "../src/SigilGateHook.sol";

contract Deploy is Script {
    function run() external {
        address token = vm.envAddress("USDT_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint256 feeBP = vm.envOr("PLATFORM_FEE_BP", uint256(500));
        address sigil = vm.envAddress("SIGIL_ADDRESS");
        address identityRegistry = vm.envAddress("IDENTITY_REGISTRY");
        address reputationRegistry = vm.envAddress("REPUTATION_REGISTRY");
        bytes32 providerPolicyId = vm.envBytes32("PROVIDER_POLICY_ID");
        bytes32 evaluatorPolicyId = vm.envBytes32("EVALUATOR_POLICY_ID");

        vm.startBroadcast();

        AgenticJobEscrow escrow = new AgenticJobEscrow(
            token, treasury, feeBP, msg.sender
        );
        console.log("AgenticJobEscrow:", address(escrow));

        SigilGateHook hook = new SigilGateHook(
            address(escrow),
            sigil,
            identityRegistry,
            reputationRegistry,
            providerPolicyId,
            evaluatorPolicyId
        );
        console.log("SigilGateHook:", address(hook));

        vm.stopBroadcast();
    }
}
