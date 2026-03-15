import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import * as secp256k1 from "@noble/secp256k1";
import { bytesToHex, hexToBytes } from "viem";

// ── Public Key Validation ──

export function validatePublicKey(pubKey: Uint8Array): void {
  if (pubKey.length !== 65 || pubKey[0] !== 0x04) {
    throw new Error("Invalid public key: must be 65-byte uncompressed secp256k1 (0x04 prefix)");
  }
  try {
    secp256k1.ProjectivePoint.fromHex(pubKey);
  } catch {
    throw new Error("Invalid public key: not a valid secp256k1 curve point");
  }
}

// ── Types ──

export interface EncryptedPackage {
  iv: string;
  encryptedContent: string;
  encryptedKey: string;
  ephemeralPublicKey: string;
}

export interface Keypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

// ── BIP-44 Key Derivation ──

const ETH_BIP44_PATH = "m/44'/60'/0'/0/0";

export function deriveKeypairFromSeed(seedPhrase: string): Keypair {
  const seed = mnemonicToSeedSync(seedPhrase, "");
  const hdkey = HDKey.fromMasterSeed(seed);
  const child = hdkey.derive(ETH_BIP44_PATH);

  if (!child.privateKey || !child.publicKey) {
    throw new Error("Failed to derive keypair from seed phrase");
  }

  return {
    privateKey: child.privateKey,
    publicKey: secp256k1.getPublicKey(child.privateKey, false), // uncompressed 65 bytes
  };
}

// ── ECIES Encrypt/Decrypt (AES key wrapping) ──

async function eciesEncrypt(
  data: Uint8Array,
  recipientPublicKey: Uint8Array
): Promise<{ ciphertext: Uint8Array; ephemeralPublicKey: Uint8Array }> {
  const ephemeralPrivKey = secp256k1.utils.randomPrivateKey();
  const ephemeralPubKey = secp256k1.getPublicKey(ephemeralPrivKey, false);

  const sharedSecret = secp256k1.getSharedSecret(ephemeralPrivKey, recipientPublicKey);
  // Use first 32 bytes of shared secret (skip the 0x04 prefix byte) as AES key
  const aesKey = sharedSecret.slice(1, 33);

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: iv (12) + authTag (16) + ciphertext
  const ciphertext = new Uint8Array(12 + 16 + encrypted.length);
  ciphertext.set(iv, 0);
  ciphertext.set(authTag, 12);
  ciphertext.set(encrypted, 28);

  return { ciphertext, ephemeralPublicKey: ephemeralPubKey };
}

function eciesDecrypt(
  ciphertext: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array
): Uint8Array {
  const sharedSecret = secp256k1.getSharedSecret(recipientPrivateKey, ephemeralPublicKey);
  const aesKey = sharedSecret.slice(1, 33);

  const iv = ciphertext.slice(0, 12);
  const authTag = ciphertext.slice(12, 28);
  const encrypted = ciphertext.slice(28);

  const decipher = createDecipheriv("aes-256-gcm", aesKey, iv);
  decipher.setAuthTag(authTag);
  return new Uint8Array(Buffer.concat([decipher.update(encrypted), decipher.final()]));
}

// ── Hybrid Encryption (AES-256-GCM content + ECIES key wrapping) ──

export async function encrypt(
  content: Buffer | Uint8Array,
  recipientPublicKey: Uint8Array
): Promise<EncryptedPackage> {
  validatePublicKey(recipientPublicKey);

  // Generate random AES-256 key for content encryption
  const contentKey = randomBytes(32);
  const iv = randomBytes(12);

  // Encrypt content with AES-256-GCM
  const cipher = createCipheriv("aes-256-gcm", contentKey, iv);
  const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack encrypted content: authTag (16) + ciphertext
  const encryptedContent = new Uint8Array(16 + encrypted.length);
  encryptedContent.set(authTag, 0);
  encryptedContent.set(encrypted, 16);

  // Encrypt the AES key with recipient's public key via ECIES
  const { ciphertext: encryptedKey, ephemeralPublicKey } = await eciesEncrypt(
    contentKey,
    recipientPublicKey
  );

  return {
    iv: bytesToHex(iv),
    encryptedContent: bytesToHex(encryptedContent),
    encryptedKey: bytesToHex(encryptedKey),
    ephemeralPublicKey: bytesToHex(ephemeralPublicKey),
  };
}

export function decrypt(
  pkg: EncryptedPackage,
  privateKey: Uint8Array
): Buffer {
  // Decrypt the AES key via ECIES
  const encryptedKeyBytes = hexToBytes(pkg.encryptedKey as `0x${string}`);
  const ephemeralPubKeyBytes = hexToBytes(pkg.ephemeralPublicKey as `0x${string}`);
  const contentKey = eciesDecrypt(encryptedKeyBytes, ephemeralPubKeyBytes, privateKey);

  // Decrypt content with AES-256-GCM
  const iv = hexToBytes(pkg.iv as `0x${string}`);
  const encryptedContent = hexToBytes(pkg.encryptedContent as `0x${string}`);
  const authTag = encryptedContent.slice(0, 16);
  const ciphertext = encryptedContent.slice(16);

  const decipher = createDecipheriv("aes-256-gcm", contentKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ── Re-encrypt Key (evaluator → client) ──

export async function reEncryptKey(
  pkg: EncryptedPackage,
  oldPrivateKey: Uint8Array,
  newPublicKey: Uint8Array
): Promise<Pick<EncryptedPackage, "encryptedKey" | "ephemeralPublicKey">> {
  // Decrypt the AES key with old private key
  const encryptedKeyBytes = hexToBytes(pkg.encryptedKey as `0x${string}`);
  const ephemeralPubKeyBytes = hexToBytes(pkg.ephemeralPublicKey as `0x${string}`);
  const contentKey = eciesDecrypt(encryptedKeyBytes, ephemeralPubKeyBytes, oldPrivateKey);

  // Re-encrypt with new public key
  const { ciphertext: newEncryptedKey, ephemeralPublicKey: newEphemeralPub } =
    await eciesEncrypt(contentKey, newPublicKey);

  return {
    encryptedKey: bytesToHex(newEncryptedKey),
    ephemeralPublicKey: bytesToHex(newEphemeralPub),
  };
}
