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

        vm.startBroadcast();

        AgenticJobEscrow escrow = new AgenticJobEscrow(
            token, treasury, feeBP, msg.sender
        );
        console.log("AgenticJobEscrow:", address(escrow));

        SigilGateHook hook = new SigilGateHook(
            address(escrow),
            sigil,
            identityRegistry
        );
        console.log("SigilGateHook:", address(hook));

        vm.stopBroadcast();
    }
}
