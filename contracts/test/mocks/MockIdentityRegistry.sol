// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

contract MockIdentityRegistry {
    mapping(uint256 => address) public owners;
    mapping(uint256 => address) public agentWallets;

    function setOwner(uint256 tokenId, address owner_) external {
        owners[tokenId] = owner_;
    }

    /// @dev Sets both owner and agent wallet (convenience for typical registration)
    function registerAgent(uint256 tokenId, address wallet) external {
        owners[tokenId] = wallet;
        agentWallets[tokenId] = wallet;
    }

    function setAgentWallet(uint256 agentId, address wallet) external {
        agentWallets[agentId] = wallet;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return owners[tokenId];
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return agentWallets[agentId];
    }
}
