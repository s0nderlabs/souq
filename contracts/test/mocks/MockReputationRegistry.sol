// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

contract MockReputationRegistry {
    struct FeedbackCall {
        uint256 agentId;
        int128 value;
    }

    FeedbackCall[] public feedbackCalls;
    bool public shouldRevert;

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8,
        string calldata,
        string calldata,
        string calldata,
        string calldata,
        bytes32
    ) external {
        if (shouldRevert) revert("MockRevert");
        feedbackCalls.push(FeedbackCall(agentId, value));
    }

    function getFeedbackCount() external view returns (uint256) {
        return feedbackCalls.length;
    }

    function getFeedback(uint256 index) external view returns (uint256 agentId, int128 value) {
        FeedbackCall storage f = feedbackCalls[index];
        return (f.agentId, f.value);
    }

    function setShouldRevert(bool shouldRevert_) external {
        shouldRevert = shouldRevert_;
    }
}
