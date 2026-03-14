// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {IACPHook} from "./interfaces/IACPHook.sol";

contract AgenticJobEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────
    // Types
    // ──────────────────────────────────────────────

    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    struct Job {
        address client;
        address provider;
        address evaluator;
        uint256 budget;
        uint256 expiredAt;
        bytes32 description;
        bytes32 deliverable;
        address hook;
        JobStatus status;
    }

    // ──────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────

    error InvalidEvaluator();
    error InvalidExpiry();
    error InvalidHook();
    error JobNotFound();
    error InvalidStatus();
    error NotClient();
    error NotProvider();
    error NotEvaluator();
    error ProviderNotSet();
    error ProviderAlreadySet();
    error BudgetMismatch(uint256 expected, uint256 actual);
    error NotExpired();
    error ZeroBudget();
    error ZeroAddress();
    error FeeTooHigh();

    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address provider,
        address evaluator,
        uint256 expiredAt,
        address hook
    );
    event ProviderSet(uint256 indexed jobId, address indexed provider);
    event BudgetSet(uint256 indexed jobId, uint256 amount);
    event JobFunded(uint256 indexed jobId, uint256 amount);
    event WorkSubmitted(uint256 indexed jobId, bytes32 deliverable);
    event JobCompleted(uint256 indexed jobId, uint256 providerPayout, uint256 platformFee);
    event JobRejected(uint256 indexed jobId, address indexed rejectedBy, bytes32 reason);
    event RefundClaimed(uint256 indexed jobId, uint256 amount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event PlatformFeeUpdated(uint256 oldFeeBP, uint256 newFeeBP);

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────

    uint256 private constant BPS_DENOMINATOR = 10_000;

    IERC20 public immutable token;
    address public treasury;
    uint256 public platformFeeBP;
    uint256 public jobCount;
    mapping(uint256 => Job) internal _jobs;

    // ──────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────

    constructor(
        address token_,
        address treasury_,
        uint256 platformFeeBP_,
        address owner_
    ) Ownable(owner_) {
        if (token_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(0)) revert ZeroAddress();
        if (platformFeeBP_ > BPS_DENOMINATOR) revert FeeTooHigh();
        token = IERC20(token_);
        treasury = treasury_;
        platformFeeBP = platformFeeBP_;
    }

    // ──────────────────────────────────────────────
    // Core Lifecycle
    // ──────────────────────────────────────────────

    function createJob(
        address provider_,
        address evaluator_,
        uint256 expiredAt_,
        bytes32 description_,
        address hook_,
        bytes calldata optParams
    ) external nonReentrant returns (uint256 jobId) {
        if (evaluator_ == address(0)) revert InvalidEvaluator();
        if (expiredAt_ <= block.timestamp) revert InvalidExpiry();

        if (hook_ != address(0)) {
            if (!ERC165Checker.supportsInterface(hook_, type(IACPHook).interfaceId)) {
                revert InvalidHook();
            }
        }

        jobId = ++jobCount;
        _jobs[jobId] = Job({
            client: msg.sender,
            provider: provider_,
            evaluator: evaluator_,
            budget: 0,
            expiredAt: expiredAt_,
            description: description_,
            deliverable: bytes32(0),
            hook: hook_,
            status: JobStatus.Open
        });

        emit JobCreated(jobId, msg.sender, provider_, evaluator_, expiredAt_, hook_);

        // afterAction ONLY for createJob (per ERC-8183 spec)
        if (hook_ != address(0)) {
            IACPHook(hook_).afterAction(
                jobId,
                this.createJob.selector,
                abi.encode(msg.sender, provider_, evaluator_, optParams)
            );
        }
    }

    function setProvider(
        uint256 jobId,
        address provider_,
        bytes calldata optParams
    ) external nonReentrant {
        Job storage job = _getJob(jobId);
        if (job.status != JobStatus.Open) revert InvalidStatus();
        if (msg.sender != job.client) revert NotClient();
        if (provider_ == address(0)) revert ZeroAddress();
        if (job.provider != address(0)) revert ProviderAlreadySet();

        address hook = job.hook;
        bytes memory hookData = abi.encode(provider_, optParams);
        _beforeHook(jobId, hook, hookData);

        // Re-validate after untrusted callback (defense-in-depth)
        if (job.status != JobStatus.Open) revert InvalidStatus();

        job.provider = provider_;
        emit ProviderSet(jobId, provider_);

        _afterHook(jobId, hook, hookData);
    }

    function setBudget(
        uint256 jobId,
        uint256 amount_,
        bytes calldata optParams
    ) external nonReentrant {
        Job storage job = _getJob(jobId);
        if (job.status != JobStatus.Open) revert InvalidStatus();
        if (msg.sender != job.provider) revert NotProvider();
        if (amount_ == 0) revert ZeroBudget();

        address hook = job.hook;
        bytes memory hookData = abi.encode(msg.sender, amount_, optParams);
        _beforeHook(jobId, hook, hookData);

        // Re-validate after untrusted callback (defense-in-depth)
        if (job.status != JobStatus.Open) revert InvalidStatus();

        job.budget = amount_;
        emit BudgetSet(jobId, amount_);

        _afterHook(jobId, hook, hookData);
    }

    function fund(
        uint256 jobId,
        uint256 expectedBudget_,
        bytes calldata optParams
    ) external nonReentrant {
        Job storage job = _getJob(jobId);
        if (job.status != JobStatus.Open) revert InvalidStatus();
        if (msg.sender != job.client) revert NotClient();
        if (job.provider == address(0)) revert ProviderNotSet();
        if (job.budget == 0) revert ZeroBudget();
        if (expectedBudget_ != job.budget) revert BudgetMismatch(expectedBudget_, job.budget);

        address hook = job.hook;
        bytes memory hookData = abi.encode(msg.sender, optParams);
        _beforeHook(jobId, hook, hookData);

        // Re-validate after untrusted callback (defense-in-depth)
        if (job.status != JobStatus.Open) revert InvalidStatus();
        if (expectedBudget_ != job.budget) revert BudgetMismatch(expectedBudget_, job.budget);

        job.status = JobStatus.Funded;
        uint256 budget = job.budget;
        token.safeTransferFrom(msg.sender, address(this), budget);

        emit JobFunded(jobId, budget);

        _afterHook(jobId, hook, hookData);
    }

    function submit(
        uint256 jobId,
        bytes32 deliverable_,
        bytes calldata optParams
    ) external nonReentrant {
        Job storage job = _getJob(jobId);
        if (job.status != JobStatus.Funded) revert InvalidStatus();
        if (msg.sender != job.provider) revert NotProvider();

        address hook = job.hook;
        bytes memory hookData = abi.encode(msg.sender, deliverable_, optParams);
        _beforeHook(jobId, hook, hookData);

        // Re-validate after untrusted callback (defense-in-depth)
        if (job.status != JobStatus.Funded) revert InvalidStatus();

        job.deliverable = deliverable_;
        job.status = JobStatus.Submitted;

        emit WorkSubmitted(jobId, deliverable_);

        _afterHook(jobId, hook, hookData);
    }

    function complete(
        uint256 jobId,
        bytes32 reason_,
        bytes calldata optParams
    ) external nonReentrant {
        Job storage job = _getJob(jobId);
        if (job.status != JobStatus.Submitted) revert InvalidStatus();
        if (msg.sender != job.evaluator) revert NotEvaluator();

        address hook = job.hook;
        bytes memory hookData = abi.encode(msg.sender, reason_, optParams);
        _beforeHook(jobId, hook, hookData);

        // Re-validate after untrusted callback (defense-in-depth)
        if (job.status != JobStatus.Submitted) revert InvalidStatus();

        job.status = JobStatus.Completed;

        uint256 budget = job.budget;
        address jobProvider = job.provider;
        uint256 fee = (budget * platformFeeBP) / BPS_DENOMINATOR;
        uint256 payout = budget - fee;

        if (fee > 0) {
            token.safeTransfer(treasury, fee);
        }
        token.safeTransfer(jobProvider, payout);

        emit JobCompleted(jobId, payout, fee);

        _afterHook(jobId, hook, hookData);
    }

    function reject(
        uint256 jobId,
        bytes32 reason_,
        bytes calldata optParams
    ) external nonReentrant {
        Job storage job = _getJob(jobId);

        if (job.status == JobStatus.Open) {
            if (msg.sender != job.client) revert NotClient();
        } else if (job.status == JobStatus.Funded || job.status == JobStatus.Submitted) {
            if (msg.sender != job.evaluator) revert NotEvaluator();
        } else {
            revert InvalidStatus();
        }

        JobStatus previousStatus = job.status;
        address hook = job.hook;
        bytes memory hookData = abi.encode(msg.sender, reason_, optParams);

        _beforeHook(jobId, hook, hookData);

        // Re-validate after untrusted callback (defense-in-depth)
        if (job.status != previousStatus) revert InvalidStatus();
        job.status = JobStatus.Rejected;

        if (previousStatus == JobStatus.Funded || previousStatus == JobStatus.Submitted) {
            token.safeTransfer(job.client, job.budget);
        }

        emit JobRejected(jobId, msg.sender, reason_);

        _afterHook(jobId, hook, hookData);
    }

    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage job = _getJob(jobId);
        if (job.status != JobStatus.Funded && job.status != JobStatus.Submitted) {
            revert InvalidStatus();
        }
        if (block.timestamp < job.expiredAt) revert NotExpired();

        job.status = JobStatus.Expired;
        token.safeTransfer(job.client, job.budget);

        emit RefundClaimed(jobId, job.budget);
        // NOT hookable — safety guarantee per ERC-8183
    }

    // ──────────────────────────────────────────────
    // Admin
    // ──────────────────────────────────────────────

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = treasury_;
        emit TreasuryUpdated(old, treasury_);
    }

    function setPlatformFee(uint256 feeBP_) external onlyOwner {
        if (feeBP_ > BPS_DENOMINATOR) revert FeeTooHigh();
        uint256 old = platformFeeBP;
        platformFeeBP = feeBP_;
        emit PlatformFeeUpdated(old, feeBP_);
    }

    // ──────────────────────────────────────────────
    // View
    // ──────────────────────────────────────────────

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    // ──────────────────────────────────────────────
    // Internal
    // ──────────────────────────────────────────────

    function _getJob(uint256 jobId) internal view returns (Job storage) {
        if (jobId == 0 || jobId > jobCount) revert JobNotFound();
        return _jobs[jobId];
    }

    function _beforeHook(uint256 jobId, address hook, bytes memory data) internal {
        if (hook != address(0)) {
            IACPHook(hook).beforeAction(jobId, msg.sig, data);
        }
    }

    function _afterHook(uint256 jobId, address hook, bytes memory data) internal {
        if (hook != address(0)) {
            IACPHook(hook).afterAction(jobId, msg.sig, data);
        }
    }
}
