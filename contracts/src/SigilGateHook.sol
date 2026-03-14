// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IACPHook} from "./interfaces/IACPHook.sol";
import {ISigil} from "./interfaces/ISigil.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";
import {IReputationRegistry} from "./interfaces/IReputationRegistry.sol";
import {AgenticJobEscrow} from "./AgenticJobEscrow.sol";

contract SigilGateHook is IACPHook {
    // ──────────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────────

    struct JobAgentIds {
        uint256 clientAgentId;
        uint256 providerAgentId;
        uint256 evaluatorAgentId;
    }

    // ──────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────

    error OnlyEscrow();
    error NotCompliant(address wallet, bytes32 policyId);
    error AgentIdMismatch(uint256 agentId, address expected, address actual);
    error ZeroAddress();

    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    event ComplianceVerified(uint256 indexed jobId, address indexed wallet, bytes32 policyId);
    event AgentIdsStored(uint256 indexed jobId, uint256 clientAgentId, uint256 providerAgentId, uint256 evaluatorAgentId);
    event ReputationWritten(uint256 indexed jobId, uint256 indexed agentId, int128 value);

    // ──────────────────────────────────────────────
    // Immutables
    // ──────────────────────────────────────────────

    address public immutable escrow;
    ISigil public immutable sigil;
    IIdentityRegistry public immutable identityRegistry;
    IReputationRegistry public immutable reputationRegistry;
    bytes32 public immutable providerPolicyId;
    bytes32 public immutable evaluatorPolicyId;

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────

    mapping(uint256 => JobAgentIds) public jobAgentIds;

    // ──────────────────────────────────────────────
    // Selectors (precomputed for matching)
    // ──────────────────────────────────────────────

    string private constant TAG_PROTOCOL = "souq";
    string private constant TAG_COMPLETED = "completed";
    string private constant TAG_REJECTED = "rejected";

    bytes4 private constant SEL_CREATE_JOB = AgenticJobEscrow.createJob.selector;
    bytes4 private constant SEL_SET_PROVIDER = AgenticJobEscrow.setProvider.selector;
    bytes4 private constant SEL_COMPLETE = AgenticJobEscrow.complete.selector;
    bytes4 private constant SEL_REJECT = AgenticJobEscrow.reject.selector;

    // ──────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────

    constructor(
        address escrow_,
        address sigil_,
        address identityRegistry_,
        address reputationRegistry_,
        bytes32 providerPolicyId_,
        bytes32 evaluatorPolicyId_
    ) {
        if (escrow_ == address(0)) revert ZeroAddress();
        if (sigil_ == address(0)) revert ZeroAddress();
        if (identityRegistry_ == address(0)) revert ZeroAddress();
        if (reputationRegistry_ == address(0)) revert ZeroAddress();
        escrow = escrow_;
        sigil = ISigil(sigil_);
        identityRegistry = IIdentityRegistry(identityRegistry_);
        reputationRegistry = IReputationRegistry(reputationRegistry_);
        providerPolicyId = providerPolicyId_;
        evaluatorPolicyId = evaluatorPolicyId_;
    }

    // ──────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert OnlyEscrow();
        _;
    }

    // ──────────────────────────────────────────────
    // IACPHook
    // ──────────────────────────────────────────────

    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external onlyEscrow {
        if (selector == SEL_SET_PROVIDER) {
            _beforeSetProvider(jobId, data);
        }
        // Other selectors: pass through (no-op)
    }

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external onlyEscrow {
        if (selector == SEL_CREATE_JOB) {
            _afterCreateJob(jobId, data);
        } else if (selector == SEL_COMPLETE) {
            _afterComplete(jobId);
        } else if (selector == SEL_REJECT) {
            _afterReject(jobId);
        }
        // Other selectors: pass through (no-op)
    }

    // ──────────────────────────────────────────────
    // IERC165
    // ──────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IACPHook).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // ──────────────────────────────────────────────
    // Internal — Gating
    // ──────────────────────────────────────────────

    function _afterCreateJob(uint256 jobId, bytes calldata data) internal {
        // data = abi.encode(client, provider, evaluator, optParams)
        (address client, address provider, address evaluator, bytes memory optParams) =
            abi.decode(data, (address, address, address, bytes));

        // Decode agentIds from optParams
        (uint256 clientAgentId, uint256 providerAgentId, uint256 evaluatorAgentId) =
            abi.decode(optParams, (uint256, uint256, uint256));

        // Verify client agentId
        _verifyAgentId(clientAgentId, client);

        // Verify evaluator agentId + compliance
        _verifyAgentId(evaluatorAgentId, evaluator);
        if (!sigil.isCompliant(evaluator, evaluatorPolicyId)) {
            revert NotCompliant(evaluator, evaluatorPolicyId);
        }
        emit ComplianceVerified(jobId, evaluator, evaluatorPolicyId);

        // Verify provider if set (direct assignment)
        if (provider != address(0)) {
            _verifyAgentId(providerAgentId, provider);
            if (!sigil.isCompliant(provider, providerPolicyId)) {
                revert NotCompliant(provider, providerPolicyId);
            }
            emit ComplianceVerified(jobId, provider, providerPolicyId);
        }

        // Store agentIds
        jobAgentIds[jobId] = JobAgentIds({
            clientAgentId: clientAgentId,
            providerAgentId: providerAgentId,
            evaluatorAgentId: evaluatorAgentId
        });
        emit AgentIdsStored(jobId, clientAgentId, providerAgentId, evaluatorAgentId);
    }

    function _beforeSetProvider(uint256 jobId, bytes calldata data) internal {
        // data = abi.encode(provider, optParams)
        (address provider, bytes memory optParams) = abi.decode(data, (address, bytes));

        // Decode providerAgentId from optParams
        uint256 providerAgentId = abi.decode(optParams, (uint256));

        // Verify agentId + compliance
        _verifyAgentId(providerAgentId, provider);
        if (!sigil.isCompliant(provider, providerPolicyId)) {
            revert NotCompliant(provider, providerPolicyId);
        }
        emit ComplianceVerified(jobId, provider, providerPolicyId);

        // Update stored providerAgentId
        jobAgentIds[jobId].providerAgentId = providerAgentId;
    }

    // ──────────────────────────────────────────────
    // Internal — Reputation
    // ──────────────────────────────────────────────

    function _afterComplete(uint256 jobId) internal {
        JobAgentIds storage ids = jobAgentIds[jobId];
        _writeFeedback(jobId, ids.providerAgentId, int128(1));
        _writeFeedback(jobId, ids.evaluatorAgentId, int128(1));
    }

    function _afterReject(uint256 jobId) internal {
        JobAgentIds storage ids = jobAgentIds[jobId];
        if (ids.providerAgentId != 0) {
            _writeFeedback(jobId, ids.providerAgentId, int128(-1));
        }
        if (ids.evaluatorAgentId != 0) {
            _writeFeedback(jobId, ids.evaluatorAgentId, int128(1));
        }
    }

    function _writeFeedback(uint256 jobId, uint256 agentId, int128 value) internal {
        // Best-effort: reputation write failure must NOT block settlement
        try reputationRegistry.giveFeedback(
            agentId,
            value,
            0,
            TAG_PROTOCOL,
            value > 0 ? TAG_COMPLETED : TAG_REJECTED,
            "",
            "",
            bytes32(jobId)
        ) {
            emit ReputationWritten(jobId, agentId, value);
        } catch {
            // Silently fail — escrow settlement is priority
        }
    }

    // ──────────────────────────────────────────────
    // Internal — Helpers
    // ──────────────────────────────────────────────

    function _verifyAgentId(uint256 agentId, address expectedOwner) internal view {
        address actual = identityRegistry.ownerOf(agentId);
        if (actual != expectedOwner) {
            revert AgentIdMismatch(agentId, expectedOwner, actual);
        }
    }
}
