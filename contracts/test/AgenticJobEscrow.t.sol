// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/AgenticJobEscrow.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockHook.sol";

contract AgenticJobEscrowTest is Test {
    AgenticJobEscrow escrow;
    MockERC20 usdt;
    MockHook hook;

    address client = address(0xC1);
    address provider = address(0xB0);
    address evaluator = address(0xE1);
    address treasury = address(0xFEE);
    address owner = address(0xAD);
    address attacker = address(0xBA);

    uint256 constant BUDGET = 1000e6; // 1000 USDT
    uint256 constant FEE_BP = 500; // 5%
    bytes32 constant DESC = keccak256("research report");
    bytes32 constant DELIVERABLE = keccak256("ipfs://QmDeliverable");
    bytes32 constant REASON = keccak256("good work");

    function setUp() public {
        usdt = new MockERC20("USDT", "USDT", 6);
        hook = new MockHook();
        escrow = new AgenticJobEscrow(address(usdt), treasury, FEE_BP, owner);

        usdt.mint(client, 100_000e6);
        vm.prank(client);
        usdt.approve(address(escrow), type(uint256).max);
    }

    // ──────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────

    function _createJob() internal returns (uint256) {
        return _createJobWith(provider, evaluator, address(0));
    }

    function _createJobWithHook() internal returns (uint256) {
        return _createJobWith(provider, evaluator, address(hook));
    }

    function _createJobWith(address prov, address eval, address hk) internal returns (uint256) {
        vm.prank(client);
        return escrow.createJob(prov, eval, block.timestamp + 1 days, DESC, hk, "");
    }

    function _createOpenJob() internal returns (uint256) {
        return _createJobWith(address(0), evaluator, address(0));
    }

    function _setBudget(uint256 jobId) internal {
        vm.prank(provider);
        escrow.setBudget(jobId, BUDGET, "");
    }

    function _fund(uint256 jobId) internal {
        vm.prank(client);
        escrow.fund(jobId, BUDGET, "");
    }

    function _submit(uint256 jobId) internal {
        vm.prank(provider);
        escrow.submit(jobId, DELIVERABLE, "");
    }

    function _setupFunded() internal returns (uint256) {
        uint256 id = _createJob();
        _setBudget(id);
        _fund(id);
        return id;
    }

    function _setupSubmitted() internal returns (uint256) {
        uint256 id = _setupFunded();
        _submit(id);
        return id;
    }

    // ──────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────

    function test_constructor_setsToken() public view {
        assertEq(address(escrow.token()), address(usdt));
    }

    function test_constructor_setsTreasury() public view {
        assertEq(escrow.treasury(), treasury);
    }

    function test_constructor_setsPlatformFee() public view {
        assertEq(escrow.platformFeeBP(), FEE_BP);
    }

    function test_constructor_setsOwner() public view {
        assertEq(escrow.owner(), owner);
    }

    function test_constructor_revert_zeroToken() public {
        vm.expectRevert(AgenticJobEscrow.ZeroAddress.selector);
        new AgenticJobEscrow(address(0), treasury, FEE_BP, owner);
    }

    function test_constructor_revert_zeroTreasury() public {
        vm.expectRevert(AgenticJobEscrow.ZeroAddress.selector);
        new AgenticJobEscrow(address(usdt), address(0), FEE_BP, owner);
    }

    function test_constructor_revert_feeTooHigh() public {
        vm.expectRevert(AgenticJobEscrow.FeeTooHigh.selector);
        new AgenticJobEscrow(address(usdt), treasury, 10001, owner);
    }

    // ──────────────────────────────────────────────
    // createJob
    // ──────────────────────────────────────────────

    function test_createJob_directAssignment() public {
        uint256 id = _createJob();
        assertEq(id, 1);

        AgenticJobEscrow.Job memory job = escrow.getJob(id);
        assertEq(job.client, client);
        assertEq(job.provider, provider);
        assertEq(job.evaluator, evaluator);
        assertEq(uint8(job.status), uint8(AgenticJobEscrow.JobStatus.Open));
    }

    function test_createJob_openJob() public {
        uint256 id = _createOpenJob();
        AgenticJobEscrow.Job memory job = escrow.getJob(id);
        assertEq(job.provider, address(0));
    }

    function test_createJob_incrementsJobCount() public {
        _createJob();
        assertEq(escrow.jobCount(), 1);
        _createJob();
        assertEq(escrow.jobCount(), 2);
    }

    function test_createJob_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit AgenticJobEscrow.JobCreated(1, client, provider, evaluator, block.timestamp + 1 days, address(0));
        _createJob();
    }

    function test_createJob_withHook_callsAfterAction() public {
        _createJobWithHook();
        assertEq(hook.getCallCount(), 1);
    }

    function test_createJob_revert_zeroEvaluator() public {
        vm.prank(client);
        vm.expectRevert(AgenticJobEscrow.InvalidEvaluator.selector);
        escrow.createJob(provider, address(0), block.timestamp + 1 days, DESC, address(0), "");
    }

    function test_createJob_revert_expiredInPast() public {
        vm.prank(client);
        vm.expectRevert(AgenticJobEscrow.InvalidExpiry.selector);
        escrow.createJob(provider, evaluator, block.timestamp - 1, DESC, address(0), "");
    }

    function test_createJob_revert_invalidHook() public {
        vm.prank(client);
        vm.expectRevert(AgenticJobEscrow.InvalidHook.selector);
        escrow.createJob(provider, evaluator, block.timestamp + 1 days, DESC, address(usdt), "");
    }

    function test_createJob_revert_hookReverts() public {
        hook.setShouldRevert(true, "blocked");
        vm.prank(client);
        vm.expectRevert("blocked");
        escrow.createJob(provider, evaluator, block.timestamp + 1 days, DESC, address(hook), "");
        assertEq(escrow.jobCount(), 0);
    }

    // ──────────────────────────────────────────────
    // setProvider
    // ──────────────────────────────────────────────

    function test_setProvider_success() public {
        uint256 id = _createOpenJob();
        vm.prank(client);
        escrow.setProvider(id, provider, "");

        AgenticJobEscrow.Job memory job = escrow.getJob(id);
        assertEq(job.provider, provider);
    }

    function test_setProvider_emitsEvent() public {
        uint256 id = _createOpenJob();
        vm.expectEmit(true, true, false, true);
        emit AgenticJobEscrow.ProviderSet(id, provider);
        vm.prank(client);
        escrow.setProvider(id, provider, "");
    }

    function test_setProvider_revert_notClient() public {
        uint256 id = _createOpenJob();
        vm.prank(attacker);
        vm.expectRevert(AgenticJobEscrow.NotClient.selector);
        escrow.setProvider(id, provider, "");
    }

    function test_setProvider_revert_notOpen() public {
        uint256 id = _setupFunded();
        vm.prank(client);
        vm.expectRevert(AgenticJobEscrow.InvalidStatus.selector);
        escrow.setProvider(id, attacker, "");
    }

    function test_setProvider_revert_zeroProvider() public {
        uint256 id = _createOpenJob();
        vm.prank(client);
        vm.expectRevert(AgenticJobEscrow.ZeroAddress.selector);
        escrow.setProvider(id, address(0), "");
    }

    function test_setProvider_revert_providerAlreadySet() public {
        uint256 id = _createJob(); // provider already set
        vm.prank(client);
        vm.expectRevert(AgenticJobEscrow.ProviderAlreadySet.selector);
        escrow.setProvider(id, attacker, "");
    }

    // ──────────────────────────────────────────────
    // setBudget
    // ──────────────────────────────────────────────

    function test_setBudget_success() public {
        uint256 id = _createJob();
        _setBudget(id);

        AgenticJobEscrow.Job memory job = escrow.getJob(id);
        assertEq(job.budget, BUDGET);
    }

    function test_setBudget_emitsEvent() public {
        uint256 id = _createJob();
        vm.expectEmit(true, false, false, true);
        emit AgenticJobEscrow.BudgetSet(id, BUDGET);
        _setBudget(id);
    }

    function test_setBudget_canUpdateMultipleTimes() public {
        uint256 id = _createJob();
        vm.prank(provider);
        escrow.setBudget(id, 500e6, "");
        vm.prank(provider);
        escrow.setBudget(id, 800e6, "");

        AgenticJobEscrow.Job memory job = escrow.getJob(id);
        assertEq(job.budget, 800e6);
    }

    function test_setBudget_revert_notProvider() public {
        uint256 id = _createJob();
        vm.prank(client);
        vm.expectRevert(AgenticJobEscrow.NotProvider.selector);
        escrow.setBudget(id, BUDGET, "");
    }

    function test_setBudget_revert_zeroBudget() public {
        uint256 id = _createJob();
        vm.prank(provider);
        vm.expectRevert(AgenticJobEscrow.ZeroBudget.selector);
        escrow.setBudget(id, 0, "");
    }

    // ──────────────────────────────────────────────
    // fund
    // ──────────────────────────────────────────────

    function test_fund_success() public {
        uint256 id = _createJob();
        _setBudget(id);

        uint256 balBefore = usdt.balanceOf(client);
        _fund(id);
        uint256 balAfter = usdt.balanceOf(client);

        AgenticJobEscrow.Job memory job = escrow.getJob(id);
        assertEq(uint8(job.status), uint8(AgenticJobEscrow.JobStatus.Funded));
        assertEq(balBefore - balAfter, BUDGET);
        assertEq(usdt.balanceOf(address(escrow)), BUDGET);
    }

    function test_fund_emitsEvent() public {
        uint256 id = _createJob();
        _setBudget(id);
        vm.expectEmit(true, false, false, true);
        emit AgenticJobEscrow.JobFunded(id, BUDGET);
        _fund(id);
    }

    function test_fund_revert_notClient() public {
        uint256 id = _createJob();
        _setBudget(id);
        vm.prank(attacker);
        vm.expectRevert(AgenticJobEscrow.NotClient.selector);
        escrow.fund(id, BUDGET, "");
    }

    function test_fund_revert_providerNotSet() public {
        uint256 id = _createOpenJob();
        vm.prank(client);
        vm.expectRevert(AgenticJobEscrow.ProviderNotSet.selector);
        escrow.fund(id, 0, "");
    }

    function test_fund_revert_zeroBudget() public {
        uint256 id = _createJob();
        // budget not set, still 0
        vm.prank(client);
        vm.expectRevert(AgenticJobEscrow.ZeroBudget.selector);
        escrow.fund(id, 0, "");
    }

    function test_fund_revert_budgetMismatch() public {
        uint256 id = _createJob();
        _setBudget(id);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(AgenticJobEscrow.BudgetMismatch.selector, 999e6, BUDGET));
        escrow.fund(id, 999e6, "");
    }

    function test_fund_revert_notOpen() public {
        uint256 id = _setupFunded();
        vm.prank(client);
        vm.expectRevert(AgenticJobEscrow.InvalidStatus.selector);
        escrow.fund(id, BUDGET, "");
    }

    // ──────────────────────────────────────────────
    // submit
    // ──────────────────────────────────────────────

    function test_submit_success() public {
        uint256 id = _setupFunded();
        _submit(id);

        AgenticJobEscrow.Job memory job = escrow.getJob(id);
        assertEq(uint8(job.status), uint8(AgenticJobEscrow.JobStatus.Submitted));
        assertEq(job.deliverable, DELIVERABLE);
    }

    function test_submit_emitsEvent() public {
        uint256 id = _setupFunded();
        vm.expectEmit(true, false, false, true);
        emit AgenticJobEscrow.WorkSubmitted(id, DELIVERABLE);
        _submit(id);
    }

    function test_submit_revert_notProvider() public {
        uint256 id = _setupFunded();
        vm.prank(attacker);
        vm.expectRevert(AgenticJobEscrow.NotProvider.selector);
        escrow.submit(id, DELIVERABLE, "");
    }

    function test_submit_revert_notFunded() public {
        uint256 id = _createJob();
        _setBudget(id);
        vm.prank(provider);
        vm.expectRevert(AgenticJobEscrow.InvalidStatus.selector);
        escrow.submit(id, DELIVERABLE, "");
    }

    // ──────────────────────────────────────────────
    // complete
    // ──────────────────────────────────────────────

    function test_complete_success() public {
        uint256 id = _setupSubmitted();

        uint256 providerBal = usdt.balanceOf(provider);
        uint256 treasuryBal = usdt.balanceOf(treasury);

        vm.prank(evaluator);
        escrow.complete(id, REASON, "");

        AgenticJobEscrow.Job memory job = escrow.getJob(id);
        assertEq(uint8(job.status), uint8(AgenticJobEscrow.JobStatus.Completed));

        uint256 expectedFee = (BUDGET * FEE_BP) / 10000;
        uint256 expectedPayout = BUDGET - expectedFee;

        assertEq(usdt.balanceOf(provider) - providerBal, expectedPayout);
        assertEq(usdt.balanceOf(treasury) - treasuryBal, expectedFee);
    }

    function test_complete_feeCalculation_5percent() public {
        uint256 id = _setupSubmitted();
        vm.prank(evaluator);
        escrow.complete(id, REASON, "");

        // 1000 USDT * 500bp = 50 USDT fee, 950 USDT payout
        assertEq(usdt.balanceOf(treasury), 50e6);
        assertEq(usdt.balanceOf(provider), 950e6);
    }

    function test_complete_emitsEvent() public {
        uint256 id = _setupSubmitted();
        uint256 expectedFee = (BUDGET * FEE_BP) / 10000;
        uint256 expectedPayout = BUDGET - expectedFee;

        vm.expectEmit(true, false, false, true);
        emit AgenticJobEscrow.JobCompleted(id, expectedPayout, expectedFee);
        vm.prank(evaluator);
        escrow.complete(id, REASON, "");
    }

    function test_complete_revert_notEvaluator() public {
        uint256 id = _setupSubmitted();
        vm.prank(attacker);
        vm.expectRevert(AgenticJobEscrow.NotEvaluator.selector);
        escrow.complete(id, REASON, "");
    }

    function test_complete_revert_notSubmitted() public {
        uint256 id = _setupFunded();
        vm.prank(evaluator);
        vm.expectRevert(AgenticJobEscrow.InvalidStatus.selector);
        escrow.complete(id, REASON, "");
    }

    // ──────────────────────────────────────────────
    // reject
    // ──────────────────────────────────────────────

    function test_reject_byClient_whenOpen() public {
        uint256 id = _createJob();
        _setBudget(id);

        vm.prank(client);
        escrow.reject(id, REASON, "");

        AgenticJobEscrow.Job memory job = escrow.getJob(id);
        assertEq(uint8(job.status), uint8(AgenticJobEscrow.JobStatus.Rejected));
        // No refund (no funds locked)
        assertEq(usdt.balanceOf(address(escrow)), 0);
    }

    function test_reject_byEvaluator_whenFunded() public {
        uint256 id = _setupFunded();
        uint256 clientBal = usdt.balanceOf(client);

        vm.prank(evaluator);
        escrow.reject(id, REASON, "");

        assertEq(usdt.balanceOf(client) - clientBal, BUDGET);
        assertEq(usdt.balanceOf(address(escrow)), 0);
    }

    function test_reject_byEvaluator_whenSubmitted() public {
        uint256 id = _setupSubmitted();
        uint256 clientBal = usdt.balanceOf(client);

        vm.prank(evaluator);
        escrow.reject(id, REASON, "");

        assertEq(usdt.balanceOf(client) - clientBal, BUDGET);
    }

    function test_reject_emitsEvent() public {
        uint256 id = _createJob();
        vm.expectEmit(true, true, false, true);
        emit AgenticJobEscrow.JobRejected(id, client, REASON);
        vm.prank(client);
        escrow.reject(id, REASON, "");
    }

    function test_reject_revert_clientCannotRejectFunded() public {
        uint256 id = _setupFunded();
        vm.prank(client);
        vm.expectRevert(AgenticJobEscrow.NotEvaluator.selector);
        escrow.reject(id, REASON, "");
    }

    function test_reject_revert_providerCannotReject() public {
        uint256 id = _createJob();
        vm.prank(provider);
        vm.expectRevert(AgenticJobEscrow.NotClient.selector);
        escrow.reject(id, REASON, "");
    }

    function test_reject_revert_alreadyCompleted() public {
        uint256 id = _setupSubmitted();
        vm.prank(evaluator);
        escrow.complete(id, REASON, "");

        vm.prank(evaluator);
        vm.expectRevert(AgenticJobEscrow.InvalidStatus.selector);
        escrow.reject(id, REASON, "");
    }

    // ──────────────────────────────────────────────
    // claimRefund
    // ──────────────────────────────────────────────

    function test_claimRefund_fromFunded() public {
        uint256 id = _setupFunded();
        uint256 clientBal = usdt.balanceOf(client);

        vm.warp(block.timestamp + 2 days);
        escrow.claimRefund(id);

        assertEq(usdt.balanceOf(client) - clientBal, BUDGET);
        AgenticJobEscrow.Job memory job = escrow.getJob(id);
        assertEq(uint8(job.status), uint8(AgenticJobEscrow.JobStatus.Expired));
    }

    function test_claimRefund_fromSubmitted() public {
        uint256 id = _setupSubmitted();
        vm.warp(block.timestamp + 2 days);
        uint256 clientBal = usdt.balanceOf(client);

        escrow.claimRefund(id);
        assertEq(usdt.balanceOf(client) - clientBal, BUDGET);
    }

    function test_claimRefund_byAnyone() public {
        uint256 id = _setupFunded();
        vm.warp(block.timestamp + 2 days);

        vm.prank(attacker);
        escrow.claimRefund(id);

        // Funds go to client, not attacker
        assertEq(usdt.balanceOf(attacker), 0);
    }

    function test_claimRefund_emitsEvent() public {
        uint256 id = _setupFunded();
        vm.warp(block.timestamp + 2 days);

        vm.expectEmit(true, false, false, true);
        emit AgenticJobEscrow.RefundClaimed(id, BUDGET);
        escrow.claimRefund(id);
    }

    function test_claimRefund_revert_notExpired() public {
        uint256 id = _setupFunded();
        vm.expectRevert(AgenticJobEscrow.NotExpired.selector);
        escrow.claimRefund(id);
    }

    function test_claimRefund_revert_notFundedOrSubmitted() public {
        uint256 id = _createJob();
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(AgenticJobEscrow.InvalidStatus.selector);
        escrow.claimRefund(id);
    }

    // ──────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────

    function test_setTreasury_success() public {
        address newTreasury = address(0xBEEF);
        vm.prank(owner);
        escrow.setTreasury(newTreasury);
        assertEq(escrow.treasury(), newTreasury);
    }

    function test_setTreasury_revert_notOwner() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", attacker));
        escrow.setTreasury(address(0xBEEF));
    }

    function test_setPlatformFee_success() public {
        vm.prank(owner);
        escrow.setPlatformFee(1000);
        assertEq(escrow.platformFeeBP(), 1000);
    }

    function test_setPlatformFee_revert_tooHigh() public {
        vm.prank(owner);
        vm.expectRevert(AgenticJobEscrow.FeeTooHigh.selector);
        escrow.setPlatformFee(10001);
    }

    // ──────────────────────────────────────────────
    // Fuzz
    // ──────────────────────────────────────────────

    function test_fuzz_complete_feeInvariant(uint256 budget) public {
        vm.assume(budget > 0 && budget <= 1_000_000_000e6);

        usdt.mint(client, budget);

        vm.prank(client);
        uint256 id = escrow.createJob(provider, evaluator, block.timestamp + 1 days, DESC, address(0), "");
        vm.prank(provider);
        escrow.setBudget(id, budget, "");
        vm.prank(client);
        escrow.fund(id, budget, "");
        vm.prank(provider);
        escrow.submit(id, DELIVERABLE, "");

        vm.prank(evaluator);
        escrow.complete(id, REASON, "");

        uint256 fee = (budget * FEE_BP) / 10000;
        uint256 payout = budget - fee;
        assertEq(fee + payout, budget);
    }

    function test_fuzz_createJob_anyExpiry(uint256 expiry) public {
        vm.assume(expiry > block.timestamp && expiry < type(uint128).max);
        vm.prank(client);
        uint256 id = escrow.createJob(provider, evaluator, expiry, DESC, address(0), "");
        assertGt(id, 0);
    }

    // ──────────────────────────────────────────────
    // E2E
    // ──────────────────────────────────────────────

    function test_e2e_directAssignment() public {
        // Create -> setBudget -> fund -> submit -> complete
        uint256 id = _createJob();
        _setBudget(id);
        _fund(id);
        _submit(id);

        vm.prank(evaluator);
        escrow.complete(id, REASON, "");

        assertEq(usdt.balanceOf(provider), 950e6);
        assertEq(usdt.balanceOf(treasury), 50e6);
        assertEq(usdt.balanceOf(address(escrow)), 0);
    }

    function test_e2e_bidFirst() public {
        // Create open -> setProvider -> setBudget -> fund -> submit -> complete
        uint256 id = _createOpenJob();

        vm.prank(client);
        escrow.setProvider(id, provider, "");

        _setBudget(id);
        _fund(id);
        _submit(id);

        vm.prank(evaluator);
        escrow.complete(id, REASON, "");

        assertEq(usdt.balanceOf(provider), 950e6);
    }

    function test_e2e_rejection_refund() public {
        uint256 id = _setupSubmitted();
        uint256 clientBal = usdt.balanceOf(client);

        vm.prank(evaluator);
        escrow.reject(id, REASON, "");

        assertEq(usdt.balanceOf(client) - clientBal, BUDGET);
        assertEq(usdt.balanceOf(address(escrow)), 0);
    }

    function test_e2e_expiry_refund() public {
        uint256 id = _setupFunded();
        vm.warp(block.timestamp + 2 days);

        escrow.claimRefund(id);

        assertEq(usdt.balanceOf(address(escrow)), 0);
    }

    function test_e2e_multipleJobs() public {
        uint256 id1 = _setupSubmitted();
        uint256 id2 = _setupSubmitted();

        vm.prank(evaluator);
        escrow.complete(id1, REASON, "");

        vm.prank(evaluator);
        escrow.reject(id2, REASON, "");

        // id1: provider got paid, id2: client got refund
        assertEq(usdt.balanceOf(provider), 950e6);
        assertEq(usdt.balanceOf(treasury), 50e6);
        // escrow should be empty
        assertEq(usdt.balanceOf(address(escrow)), 0);
    }
}
