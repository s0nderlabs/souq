import * as secp256k1 from "@noble/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "viem";

// ── Types ──

export interface EncryptedPackage {
  iv: string;
  encryptedContent: string;
  encryptedKey: string;
  ephemeralPublicKey: string;
}

export interface EncryptionKeypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array; // 65 bytes, uncompressed (0x04 prefix)
  publicKeyHex: string;  // "0x04..."
}

// ── Keypair Derivation ──

let cachedKeypair: EncryptionKeypair | null = null;

/**
 * Derive a deterministic secp256k1 keypair from a wallet signature.
 * Same wallet + same message → same signature → same keypair (RFC6979).
 *
 * @param signMessage - Function that signs a message (from Privy useWallets)
 */
export async function deriveEncryptionKeypair(
  signMessage: (message: string) => Promise<string>
): Promise<EncryptionKeypair> {
  if (cachedKeypair) return cachedKeypair;

  // Sign a deterministic message — the signature becomes the entropy source
  const signature = await signMessage("souq:encryption:v1");

  // SHA-256 hash the signature to get a 32-byte private key
  const sigBytes = hexToBytes(signature as `0x${string}`);
  const privateKey = sha256(sigBytes);

  // Derive uncompressed public key (65 bytes, 0x04 prefix)
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  const publicKeyHex = bytesToHex(publicKey);

  cachedKeypair = { privateKey, publicKey, publicKeyHex };
  console.log("[souq] Encryption keypair derived:", publicKeyHex.slice(0, 16) + "...");
  return cachedKeypair;
}

/** Get cached keypair without triggering derivation */
export function getCachedKeypair(): EncryptionKeypair | null {
  return cachedKeypair;
}

/** Clear cached keypair (on logout) */
export function clearKeypair(): void {
  cachedKeypair = null;
}

// ── AES-256-GCM via Web Crypto ──

async function aesGcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  // Web Crypto expects ciphertext + authTag concatenated
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    ciphertext.buffer as ArrayBuffer
  );
  return new Uint8Array(plaintext);
}

// ── ECIES Decrypt ──

/**
 * Decrypt an EncryptedPackage using the recipient's private key.
 * Mirrors the plugin's decrypt() in encryption.ts.
 *
 * Flow:
 * 1. ECDH: sharedSecret = getSharedSecret(privateKey, ephemeralPublicKey)[1..33]
 * 2. AES-GCM decrypt the encryptedKey using sharedSecret → recover 32-byte content key
 * 3. AES-GCM decrypt the encryptedContent using content key → plaintext
 */
export async function browserDecrypt(
  pkg: EncryptedPackage,
  privateKey: Uint8Array
): Promise<string> {
  // Parse hex fields
  const ephemeralPub = hexToBytes(pkg.ephemeralPublicKey as `0x${string}`);
  const encryptedKeyBytes = hexToBytes(pkg.encryptedKey as `0x${string}`);
  const contentIv = hexToBytes(pkg.iv as `0x${string}`);
  const encryptedContent = hexToBytes(pkg.encryptedContent as `0x${string}`);

  // Step 1: ECDH shared secret
  const sharedFull = secp256k1.getSharedSecret(privateKey, ephemeralPub);
  const sharedSecret = sharedFull.slice(1, 33); // skip 0x04 prefix, take 32 bytes

  // Step 2: Decrypt the AES content key
  // encryptedKey format: iv(12) + authTag(16) + ciphertext
  const keyIv = encryptedKeyBytes.slice(0, 12);
  const keyAuthTag = encryptedKeyBytes.slice(12, 28);
  const keyCiphertext = encryptedKeyBytes.slice(28);
  // Web Crypto expects ciphertext + authTag concatenated
  const keyData = new Uint8Array([...keyCiphertext, ...keyAuthTag]);
  const contentKey = await aesGcmDecrypt(sharedSecret, keyIv, keyData);

  // Step 3: Decrypt the content
  // encryptedContent format: authTag(16) + ciphertext
  const contentAuthTag = encryptedContent.slice(0, 16);
  const contentCiphertext = encryptedContent.slice(16);
  const contentData = new Uint8Array([...contentCiphertext, ...contentAuthTag]);
  const plaintext = await aesGcmDecrypt(contentKey, contentIv, contentData);

  return new TextDecoder().decode(plaintext);
}
