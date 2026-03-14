// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IACPHook} from "../../src/interfaces/IACPHook.sol";

contract MockHook is IACPHook {
    struct HookCall {
        uint256 jobId;
        bytes4 selector;
        bytes data;
        bool isBefore;
    }

    HookCall[] public calls;
    bool public shouldRevert;
    string public revertReason;

    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external override {
        if (shouldRevert) revert(revertReason);
        calls.push(HookCall(jobId, selector, data, true));
    }

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external override {
        if (shouldRevert) revert(revertReason);
        calls.push(HookCall(jobId, selector, data, false));
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IACPHook).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function setShouldRevert(bool shouldRevert_, string calldata reason_) external {
        shouldRevert = shouldRevert_;
        revertReason = reason_;
    }

    function getCallCount() external view returns (uint256) {
        return calls.length;
    }
}
