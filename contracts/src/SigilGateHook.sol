// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IACPHook} from "./interfaces/IACPHook.sol";
import {ISigil} from "./interfaces/ISigil.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";
import {AgenticJobEscrow} from "./AgenticJobEscrow.sol";

/// @title SigilGateHook — Gating-only hook for Souq Protocol
/// @notice Checks Sigil compliance for providers and evaluators. No reputation writing.
contract SigilGateHook is IACPHook {
    // ──────────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────────

    struct JobData {
        uint256 clientAgentId;
        uint256 providerAgentId;
        uint256 evaluatorAgentId;
        bytes32[] providerPolicies;
        bytes32[] evaluatorPolicies;
    }

    // ──────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────

    error OnlyEscrow();
    error NotCompliant(address wallet, bytes32 policyId);
    error AgentIdMismatch(uint256 agentId, address expected, address actual);
    error ZeroAddress();
    error EmptyPolicies();

    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    event ComplianceVerified(uint256 indexed jobId, address indexed wallet, bytes32 policyId);
    event JobDataStored(uint256 indexed jobId, uint256 clientAgentId, uint256 providerAgentId, uint256 evaluatorAgentId);

    // ──────────────────────────────────────────────
    // Immutables
    // ──────────────────────────────────────────────

    address public immutable escrow;
    ISigil public immutable sigil;
    IIdentityRegistry public immutable identityRegistry;

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────

    mapping(uint256 => JobData) internal _jobData;

    // ──────────────────────────────────────────────
    // Selectors
    // ──────────────────────────────────────────────

    bytes4 private constant SEL_CREATE_JOB = AgenticJobEscrow.createJob.selector;
    bytes4 private constant SEL_SET_PROVIDER = AgenticJobEscrow.setProvider.selector;

    // ──────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────

    constructor(
        address escrow_,
        address sigil_,
        address identityRegistry_
    ) {
        if (escrow_ == address(0)) revert ZeroAddress();
        if (sigil_ == address(0)) revert ZeroAddress();
        if (identityRegistry_ == address(0)) revert ZeroAddress();
        escrow = escrow_;
        sigil = ISigil(sigil_);
        identityRegistry = IIdentityRegistry(identityRegistry_);
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
    }

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external onlyEscrow {
        if (selector == SEL_CREATE_JOB) {
            _afterCreateJob(jobId, data);
        }
        // complete/reject: no-op (reputation is voluntary via plugin)
    }

    // ──────────────────────────────────────────────
    // IERC165
    // ──────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IACPHook).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // ──────────────────────────────────────────────
    // View
    // ──────────────────────────────────────────────

    function getJobData(uint256 jobId) external view returns (JobData memory) {
        return _jobData[jobId];
    }

    // ──────────────────────────────────────────────
    // Internal — Gating
    // ──────────────────────────────────────────────

    function _afterCreateJob(uint256 jobId, bytes calldata data) internal {
        // data = abi.encode(client, provider, evaluator, optParams)
        (address client, address provider, address evaluator, bytes memory optParams) =
            abi.decode(data, (address, address, address, bytes));

        // Decode from optParams
        (
            uint256 clientAgentId,
            uint256 providerAgentId,
            uint256 evaluatorAgentId,
            bytes32[] memory providerPolicies,
            bytes32[] memory evaluatorPolicies
        ) = abi.decode(optParams, (uint256, uint256, uint256, bytes32[], bytes32[]));

        // Evaluator policies must not be empty
        if (evaluatorPolicies.length == 0) revert EmptyPolicies();

        // Verify client agentId
        _verifyAgentId(clientAgentId, client);

        // Verify evaluator agentId + all policies
        _verifyAgentId(evaluatorAgentId, evaluator);
        _checkCompliance(jobId, evaluator, evaluatorPolicies);

        // Verify provider if set (direct assignment)
        if (provider != address(0)) {
            if (providerPolicies.length == 0) revert EmptyPolicies();
            _verifyAgentId(providerAgentId, provider);
            _checkCompliance(jobId, provider, providerPolicies);
        }

        // Store per-job data
        JobData storage jd = _jobData[jobId];
        jd.clientAgentId = clientAgentId;
        jd.providerAgentId = providerAgentId;
        jd.evaluatorAgentId = evaluatorAgentId;
        jd.providerPolicies = providerPolicies;
        jd.evaluatorPolicies = evaluatorPolicies;

        emit JobDataStored(jobId, clientAgentId, providerAgentId, evaluatorAgentId);
    }

    function _beforeSetProvider(uint256 jobId, bytes calldata data) internal {
        // data = abi.encode(provider, optParams)
        (address provider, bytes memory optParams) = abi.decode(data, (address, bytes));

        // Decode providerAgentId from optParams
        uint256 providerAgentId = abi.decode(optParams, (uint256));

        // Verify agentId
        _verifyAgentId(providerAgentId, provider);

        // Read stored provider policies from createJob
        bytes32[] storage policies = _jobData[jobId].providerPolicies;
        if (policies.length == 0) revert EmptyPolicies();
        _checkCompliance(jobId, provider, policies);

        // Update stored providerAgentId
        _jobData[jobId].providerAgentId = providerAgentId;
    }

    // ──────────────────────────────────────────────
    // Internal — Helpers
    // ──────────────────────────────────────────────

    function _checkCompliance(uint256 jobId, address wallet, bytes32[] memory policies) internal {
        for (uint256 i; i < policies.length;) {
            if (!sigil.isCompliant(wallet, policies[i])) {
                revert NotCompliant(wallet, policies[i]);
            }
            emit ComplianceVerified(jobId, wallet, policies[i]);
            unchecked { ++i; }
        }
    }

    function _verifyAgentId(uint256 agentId, address expectedOwner) internal view {
        address actual = identityRegistry.ownerOf(agentId);
        if (actual != expectedOwner) {
            revert AgentIdMismatch(agentId, expectedOwner, actual);
        }
    }
}
