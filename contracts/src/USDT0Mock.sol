// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title USDT0Mock
 * @notice Testnet USDT0 with EIP-3009 (transferWithAuthorization) + ERC-1271 (smart account signatures)
 * @dev Simplified version of Tether's USDT0 for Sepolia testing.
 *      Includes the features needed for x402 payments from ERC-4337 Smart Accounts:
 *      - ERC-20 (6 decimals)
 *      - EIP-2612 permit (via OpenZeppelin ERC20Permit)
 *      - EIP-3009 transferWithAuthorization (with ERC-1271 fallback via SignatureChecker)
 *      - Public mint for testnet faucet
 */
contract USDT0Mock is ERC20Permit {
    // ── EIP-3009 ──

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    // Track used nonces per authorizer (EIP-3009 uses bytes32 nonces, not sequential)
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    // ── Events ──

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    // ── Errors ──

    error AuthorizationExpired();
    error AuthorizationNotYetValid();
    error AuthorizationAlreadyUsed();
    error InvalidSignature();
    error CallerMustBeReceiver();

    // ── Constructor ──

    constructor() ERC20("USD\xE2\x82\xAE0", "USDT0") ERC20Permit("USDT0") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ── Public Mint (testnet only) ──

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    // ── EIP-3009: transferWithAuthorization ──

    /**
     * @notice Execute a transfer with a signed authorization (EIP-3009)
     * @dev Uses OpenZeppelin's SignatureChecker which supports both:
     *      - ECDSA signatures from EOA wallets
     *      - ERC-1271 signatures from Smart Account wallets (e.g., Safe)
     */
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, abi.encodePacked(r, s, v));
    }

    /**
     * @notice Execute a transfer with a signed authorization (bytes signature variant)
     * @dev Accepts arbitrary-length signatures for ERC-1271 smart account wallets
     */
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external {
        _transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, signature);
    }

    // ── EIP-3009: receiveWithAuthorization ──

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (to != msg.sender) revert CallerMustBeReceiver();
        _transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, abi.encodePacked(r, s, v));
    }

    // ── Internal ──

    function _transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) internal {
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (authorizationState[from][nonce]) revert AuthorizationAlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        // SignatureChecker: tries ecrecover first, falls back to ERC-1271 isValidSignature
        // This is what makes Smart Account (Safe) signatures work
        if (!SignatureChecker.isValidSignatureNow(from, digest, signature)) {
            revert InvalidSignature();
        }

        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);

        _transfer(from, to, value);
    }
}
