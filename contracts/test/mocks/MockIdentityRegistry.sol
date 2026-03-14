// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

contract MockIdentityRegistry {
    mapping(uint256 => address) public owners;

    function setOwner(uint256 tokenId, address owner_) external {
        owners[tokenId] = owner_;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return owners[tokenId];
    }
}
