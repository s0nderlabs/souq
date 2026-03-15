// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/AgenticJobEscrow.sol";
import "../src/SigilGateHook.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockSigil.sol";
import "./mocks/MockIdentityRegistry.sol";

contract SigilGateHookTest is Test {
    AgenticJobEscrow escrow;
    SigilGateHook hook;
    MockERC20 usdt;
    MockSigil sigil;
    MockIdentityRegistry identity;

    address client = address(0xC1);
    address provider = address(0xB0);
    address evaluator = address(0xE1);
    address treasury = address(0xFEE);
    address owner = address(0xAD);
    address attacker = address(0xBA);

    uint256 constant CLIENT_AGENT_ID = 100;
    uint256 constant PROVIDER_AGENT_ID = 200;
    uint256 constant EVALUATOR_AGENT_ID = 300;
    uint256 constant BUDGET = 1000e6;

    bytes32 constant PROVIDER_POLICY = keccak256("souq-provider");
    bytes32 constant PROVIDER_POLICY_2 = keccak256("research-compliance");
    bytes32 constant PROVIDER_POLICY_3 = keccak256("defi-experience");
    bytes32 constant EVALUATOR_POLICY = keccak256("souq-evaluator");
    bytes32 constant EVALUATOR_POLICY_2 = keccak256("evaluator-advanced");
    bytes32 constant DESC = keccak256("research report");
    bytes32 constant DELIVERABLE = keccak256("ipfs://QmDeliverable");
    bytes32 constant REASON = keccak256("good work");

    function setUp() public {
        usdt = new MockERC20("USDT", "USDT", 6);
        sigil = new MockSigil();
        identity = new MockIdentityRegistry();

        escrow = new AgenticJobEscrow(address(usdt), treasury, 500, owner);

        hook = new SigilGateHook(
            address(escrow),
            address(sigil),
            address(identity)
        );

        // Setup agentId ownership
        identity.setOwner(CLIENT_AGENT_ID, client);
        identity.setOwner(PROVIDER_AGENT_ID, provider);
        identity.setOwner(EVALUATOR_AGENT_ID, evaluator);

        // Setup Sigil compliance (default: one policy each)
        sigil.setCompliance(provider, PROVIDER_POLICY, true);
        sigil.setCompliance(evaluator, EVALUATOR_POLICY, true);

        // Fund client
        usdt.mint(client, 100_000e6);
        vm.prank(client);
        usdt.approve(address(escrow), type(uint256).max);
    }

    // ──────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────

    function _providerPolicies() internal pure returns (bytes32[] memory) {
        bytes32[] memory p = new bytes32[](1);
        p[0] = PROVIDER_POLICY;
        return p;
    }

    function _evaluatorPolicies() internal pure returns (bytes32[] memory) {
        bytes32[] memory p = new bytes32[](1);
        p[0] = EVALUATOR_POLICY;
        return p;
    }

    function _optParams() internal pure returns (bytes memory) {
        return abi.encode(
            CLIENT_AGENT_ID, PROVIDER_AGENT_ID, EVALUATOR_AGENT_ID,
            _providerPolicies(), _evaluatorPolicies()
        );
    }

    function _optParamsOpenJob() internal pure returns (bytes memory) {
        return abi.encode(
            CLIENT_AGENT_ID, uint256(0), EVALUATOR_AGENT_ID,
            _providerPolicies(), _evaluatorPolicies()
        );
    }

    function _createJob() internal returns (uint256) {
        vm.prank(client);
        return escrow.createJob(provider, evaluator, block.timestamp + 1 days, DESC, address(hook), _optParams());
    }

    function _createOpenJob() internal returns (uint256) {
        vm.prank(client);
        return escrow.createJob(address(0), evaluator, block.timestamp + 1 days, DESC, address(hook), _optParamsOpenJob());
    }

    function _setupSubmitted() internal returns (uint256) {
        uint256 id = _createJob();
        vm.prank(provider);
        escrow.setBudget(id, BUDGET, "");
        vm.prank(client);
        escrow.fund(id, BUDGET, "");
        vm.prank(provider);
        escrow.submit(id, DELIVERABLE, "");
        return id;
    }

    // ──────────────────────────────────────────────
    // supportsInterface
    // ──────────────────────────────────────────────

    function test_supportsInterface_IACPHook() public view {
        assertTrue(hook.supportsInterface(type(IACPHook).interfaceId));
    }

    function test_supportsInterface_IERC165() public view {
        assertTrue(hook.supportsInterface(type(IERC165).interfaceId));
    }

    function test_supportsInterface_randomFalse() public view {
        assertFalse(hook.supportsInterface(0xdeadbeef));
    }

    // ──────────────────────────────────────────────
    // createJob — afterAction gating (single policy)
    // ──────────────────────────────────────────────

    function test_afterCreateJob_directAssignment_passes() public {
        uint256 id = _createJob();
        assertGt(id, 0);

        SigilGateHook.JobData memory jd = hook.getJobData(id);
        assertEq(jd.clientAgentId, CLIENT_AGENT_ID);
        assertEq(jd.providerAgentId, PROVIDER_AGENT_ID);
        assertEq(jd.evaluatorAgentId, EVALUATOR_AGENT_ID);
        assertEq(jd.providerPolicies.length, 1);
        assertEq(jd.evaluatorPolicies.length, 1);
    }

    function test_afterCreateJob_openJob_passes() public {
        uint256 id = _createOpenJob();
        assertGt(id, 0);

        SigilGateHook.JobData memory jd = hook.getJobData(id);
        assertEq(jd.providerAgentId, 0);
        assertEq(jd.providerPolicies.length, 1); // stored for later setProvider
    }

    function test_afterCreateJob_revert_evaluatorNotCompliant() public {
        sigil.setCompliance(evaluator, EVALUATOR_POLICY, false);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(SigilGateHook.NotCompliant.selector, evaluator, EVALUATOR_POLICY));
        escrow.createJob(provider, evaluator, block.timestamp + 1 days, DESC, address(hook), _optParams());
    }

    function test_afterCreateJob_revert_providerNotCompliant() public {
        sigil.setCompliance(provider, PROVIDER_POLICY, false);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(SigilGateHook.NotCompliant.selector, provider, PROVIDER_POLICY));
        escrow.createJob(provider, evaluator, block.timestamp + 1 days, DESC, address(hook), _optParams());
    }

    function test_afterCreateJob_revert_evaluatorAgentIdMismatch() public {
        identity.setOwner(EVALUATOR_AGENT_ID, attacker);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(SigilGateHook.AgentIdMismatch.selector, EVALUATOR_AGENT_ID, evaluator, attacker));
        escrow.createJob(provider, evaluator, block.timestamp + 1 days, DESC, address(hook), _optParams());
    }

    function test_afterCreateJob_revert_clientAgentIdMismatch() public {
        identity.setOwner(CLIENT_AGENT_ID, attacker);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(SigilGateHook.AgentIdMismatch.selector, CLIENT_AGENT_ID, client, attacker));
        escrow.createJob(provider, evaluator, block.timestamp + 1 days, DESC, address(hook), _optParams());
    }

    // ──────────────────────────────────────────────
    // createJob — multiple policies
    // ──────────────────────────────────────────────

    function test_afterCreateJob_multiplePolicies_allPass() public {
        // Provider needs 3 policies
        sigil.setCompliance(provider, PROVIDER_POLICY, true);
        sigil.setCompliance(provider, PROVIDER_POLICY_2, true);
        sigil.setCompliance(provider, PROVIDER_POLICY_3, true);

        bytes32[] memory pp = new bytes32[](3);
        pp[0] = PROVIDER_POLICY;
        pp[1] = PROVIDER_POLICY_2;
        pp[2] = PROVIDER_POLICY_3;

        bytes memory optParams = abi.encode(
            CLIENT_AGENT_ID, PROVIDER_AGENT_ID, EVALUATOR_AGENT_ID,
            pp, _evaluatorPolicies()
        );

        vm.prank(client);
        uint256 id = escrow.createJob(provider, evaluator, block.timestamp + 1 days, DESC, address(hook), optParams);

        SigilGateHook.JobData memory jd = hook.getJobData(id);
        assertEq(jd.providerPolicies.length, 3);
    }

    function test_afterCreateJob_multiplePolicies_oneFails() public {
        sigil.setCompliance(provider, PROVIDER_POLICY, true);
        sigil.setCompliance(provider, PROVIDER_POLICY_2, true);
        sigil.setCompliance(provider, PROVIDER_POLICY_3, false); // fails

        bytes32[] memory pp = new bytes32[](3);
        pp[0] = PROVIDER_POLICY;
        pp[1] = PROVIDER_POLICY_2;
        pp[2] = PROVIDER_POLICY_3;

        bytes memory optParams = abi.encode(
            CLIENT_AGENT_ID, PROVIDER_AGENT_ID, EVALUATOR_AGENT_ID,
            pp, _evaluatorPolicies()
        );

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(SigilGateHook.NotCompliant.selector, provider, PROVIDER_POLICY_3));
        escrow.createJob(provider, evaluator, block.timestamp + 1 days, DESC, address(hook), optParams);
    }

    function test_afterCreateJob_multipleEvaluatorPolicies() public {
        sigil.setCompliance(evaluator, EVALUATOR_POLICY, true);
        sigil.setCompliance(evaluator, EVALUATOR_POLICY_2, true);

        bytes32[] memory ep = new bytes32[](2);
        ep[0] = EVALUATOR_POLICY;
        ep[1] = EVALUATOR_POLICY_2;

        bytes memory optParams = abi.encode(
            CLIENT_AGENT_ID, PROVIDER_AGENT_ID, EVALUATOR_AGENT_ID,
            _providerPolicies(), ep
        );

        vm.prank(client);
        uint256 id = escrow.createJob(provider, evaluator, block.timestamp + 1 days, DESC, address(hook), optParams);

        SigilGateHook.JobData memory jd = hook.getJobData(id);
        assertEq(jd.evaluatorPolicies.length, 2);
    }

    function test_afterCreateJob_revert_emptyEvaluatorPolicies() public {
        bytes32[] memory emptyPolicies = new bytes32[](0);

        bytes memory optParams = abi.encode(
            CLIENT_AGENT_ID, PROVIDER_AGENT_ID, EVALUATOR_AGENT_ID,
            _providerPolicies(), emptyPolicies
        );

        vm.prank(client);
        vm.expectRevert(SigilGateHook.EmptyPolicies.selector);
        escrow.createJob(provider, evaluator, block.timestamp + 1 days, DESC, address(hook), optParams);
    }

    function test_afterCreateJob_revert_emptyProviderPolicies_directAssignment() public {
        bytes32[] memory emptyPolicies = new bytes32[](0);

        bytes memory optParams = abi.encode(
            CLIENT_AGENT_ID, PROVIDER_AGENT_ID, EVALUATOR_AGENT_ID,
            emptyPolicies, _evaluatorPolicies()
        );

        vm.prank(client);
        vm.expectRevert(SigilGateHook.EmptyPolicies.selector);
        escrow.createJob(provider, evaluator, block.timestamp + 1 days, DESC, address(hook), optParams);
    }

    // ──────────────────────────────────────────────
    // setProvider — beforeAction gating
    // ──────────────────────────────────────────────

    function test_beforeSetProvider_passes() public {
        uint256 id = _createOpenJob();

        bytes memory optParams = abi.encode(PROVIDER_AGENT_ID);
        vm.prank(client);
        escrow.setProvider(id, provider, optParams);

        SigilGateHook.JobData memory jd = hook.getJobData(id);
        assertEq(jd.providerAgentId, PROVIDER_AGENT_ID);
    }

    function test_beforeSetProvider_checksStoredPolicies() public {
        // Create open job with 2 provider policies
        sigil.setCompliance(provider, PROVIDER_POLICY, true);
        sigil.setCompliance(provider, PROVIDER_POLICY_2, true);

        bytes32[] memory pp = new bytes32[](2);
        pp[0] = PROVIDER_POLICY;
        pp[1] = PROVIDER_POLICY_2;

        bytes memory createOptParams = abi.encode(
            CLIENT_AGENT_ID, uint256(0), EVALUATOR_AGENT_ID,
            pp, _evaluatorPolicies()
        );

        vm.prank(client);
        uint256 id = escrow.createJob(address(0), evaluator, block.timestamp + 1 days, DESC, address(hook), createOptParams);

        // setProvider — hook reads stored policies, checks both
        bytes memory setProvOptParams = abi.encode(PROVIDER_AGENT_ID);
        vm.prank(client);
        escrow.setProvider(id, provider, setProvOptParams);

        SigilGateHook.JobData memory jd = hook.getJobData(id);
        assertEq(jd.providerAgentId, PROVIDER_AGENT_ID);
    }

    function test_beforeSetProvider_revert_notCompliant() public {
        uint256 id = _createOpenJob();
        sigil.setCompliance(provider, PROVIDER_POLICY, false);

        bytes memory optParams = abi.encode(PROVIDER_AGENT_ID);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(SigilGateHook.NotCompliant.selector, provider, PROVIDER_POLICY));
        escrow.setProvider(id, provider, optParams);
    }

    function test_beforeSetProvider_revert_agentIdMismatch() public {
        uint256 id = _createOpenJob();
        identity.setOwner(PROVIDER_AGENT_ID, attacker);

        bytes memory optParams = abi.encode(PROVIDER_AGENT_ID);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(SigilGateHook.AgentIdMismatch.selector, PROVIDER_AGENT_ID, provider, attacker));
        escrow.setProvider(id, provider, optParams);
    }

    // ──────────────────────────────────────────────
    // complete/reject — no reputation (gating only)
    // ──────────────────────────────────────────────

    function test_complete_noReputationWritten() public {
        uint256 id = _setupSubmitted();

        vm.prank(evaluator);
        escrow.complete(id, REASON, "");

        // Job completed, provider got paid — hook did nothing extra
        assertEq(usdt.balanceOf(provider), 950e6);
    }

    function test_reject_noReputationWritten() public {
        uint256 id = _setupSubmitted();

        vm.prank(evaluator);
        escrow.reject(id, REASON, "");

        // Job rejected, client got refund — hook did nothing extra
        assertEq(usdt.balanceOf(address(escrow)), 0);
    }

    // ──────────────────────────────────────────────
    // Access control
    // ──────────────────────────────────────────────

    function test_beforeAction_revert_notEscrow() public {
        vm.prank(attacker);
        vm.expectRevert(SigilGateHook.OnlyEscrow.selector);
        hook.beforeAction(1, bytes4(0), "");
    }

    function test_afterAction_revert_notEscrow() public {
        vm.prank(attacker);
        vm.expectRevert(SigilGateHook.OnlyEscrow.selector);
        hook.afterAction(1, bytes4(0), "");
    }

    // ──────────────────────────────────────────────
    // Integration — full lifecycle with hook
    // ──────────────────────────────────────────────

    function test_integration_fullLifecycle() public {
        uint256 id = _createJob();

        vm.prank(provider);
        escrow.setBudget(id, BUDGET, "");

        vm.prank(client);
        escrow.fund(id, BUDGET, "");

        vm.prank(provider);
        escrow.submit(id, DELIVERABLE, "");

        vm.prank(evaluator);
        escrow.complete(id, REASON, "");

        assertEq(usdt.balanceOf(provider), 950e6);
        assertEq(usdt.balanceOf(treasury), 50e6);
    }

    function test_integration_bidFirst_fullLifecycle() public {
        uint256 id = _createOpenJob();

        bytes memory setProvOptParams = abi.encode(PROVIDER_AGENT_ID);
        vm.prank(client);
        escrow.setProvider(id, provider, setProvOptParams);

        vm.prank(provider);
        escrow.setBudget(id, BUDGET, "");

        vm.prank(client);
        escrow.fund(id, BUDGET, "");

        vm.prank(provider);
        escrow.submit(id, DELIVERABLE, "");

        vm.prank(evaluator);
        escrow.complete(id, REASON, "");

        assertEq(usdt.balanceOf(provider), 950e6);
    }
}
