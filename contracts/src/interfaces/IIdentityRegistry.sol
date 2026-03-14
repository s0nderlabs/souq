// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

interface IIdentityRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);
}
