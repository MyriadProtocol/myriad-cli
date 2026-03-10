import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Wallet } from "ethers";
import {
  __setWalletStoreTestOverrides,
  configureGeneratedWallet,
  configureWalletFromSecret,
  loadConfiguredWalletPrivateKey,
  readConfiguredWalletAddress,
  walletStoragePath
} from "../dist/wallet-store.js";
import { WalletStorageError } from "../dist/wallet-errors.js";

const PRIVATE_KEY_A = "0x59c6995e998f97a5a0044966f094538e3f5ed6a45d8f4d35f7f510f0f4f3f0f0";
const PRIVATE_KEY_B = "0x8b3a350cf5c34c9194ca3a545d0d84f0e23d8f35b67f5f6d151dc65ab61f0877";

function createMemoryKeychain(initialSecret = undefined) {
  let secret = initialSecret;

  return {
    backend: "linux-secret-tool",
    service: "myriad-cli",
    account: "wallet-master-secret-v1",
    async isAvailable() {
      return true;
    },
    async getSecret() {
      if (secret === undefined) {
        throw new WalletStorageError("KEYCHAIN_SECRET_NOT_FOUND", "Missing keychain secret.");
      }
      return secret;
    },
    async setSecret(value) {
      secret = value;
    },
    async deleteSecret() {
      secret = undefined;
    },
    _setSecretForTest(value) {
      secret = value;
    }
  };
}

async function withTempConfigDir(callback) {
  const configDir = await mkdtemp(path.join(tmpdir(), "myriad-wallet-store-test-"));
  try {
    await callback(configDir);
  } finally {
    __setWalletStoreTestOverrides(undefined);
    await rm(configDir, { recursive: true, force: true });
  }
}

test("configureWalletFromSecret writes wallet file v2 and returns keychain metadata", async () => {
  await withTempConfigDir(async (configDir) => {
    const keychain = createMemoryKeychain();
    const options = {
      keychain,
      paths: { configDir }
    };

    const result = await configureWalletFromSecret("private-key", PRIVATE_KEY_A, options);
    const filePath = walletStoragePath(options);
    const raw = await readFile(filePath, "utf8");
    const payload = JSON.parse(raw);

    assert.equal(payload.version, 2);
    assert.equal(payload.encryption.cipher, "aes-256-gcm");
    assert.equal(payload.encryption.kdf, "scrypt");
    assert.equal(payload.encryption.kdfparams.n, 262144);
    assert.equal(payload.encryption.kdfparams.r, 8);
    assert.equal(payload.encryption.kdfparams.p, 1);
    assert.equal(typeof payload.encryption.salt, "string");
    assert.equal(typeof payload.encryption.iv, "string");
    assert.equal(typeof payload.encryption.tag, "string");
    assert.equal(typeof payload.data, "string");

    assert.equal(result.keychainBackend, "linux-secret-tool");
    assert.equal(result.keychainService, "myriad-cli");
    assert.equal(result.keychainAccount, "wallet-master-secret-v1");
    assert.equal(result.walletFile, filePath);
  });
});

test("configureGeneratedWallet stores generated source and can be reloaded", async () => {
  await withTempConfigDir(async (configDir) => {
    const keychain = createMemoryKeychain();
    const options = {
      keychain,
      paths: { configDir }
    };

    const result = await configureGeneratedWallet(options);
    const raw = await readFile(walletStoragePath(options), "utf8");
    const payload = JSON.parse(raw);

    assert.equal(result.importedFrom, "generated");
    assert.equal(payload.importedFrom, "generated");
    assert.ok(result.seedPhrase.split(/\s+/).length >= 12);

    const loadedPrivateKey = await loadConfiguredWalletPrivateKey(options);
    assert.equal(new Wallet(loadedPrivateKey).address, result.address);
  });
});

test("configured wallet decrypts to original private key and address", async () => {
  await withTempConfigDir(async (configDir) => {
    const keychain = createMemoryKeychain();
    const options = {
      keychain,
      paths: { configDir }
    };

    await configureWalletFromSecret("private-key", PRIVATE_KEY_A, options);
    __setWalletStoreTestOverrides(undefined);

    const loadedPrivateKey = await loadConfiguredWalletPrivateKey(options);
    const loadedAddress = await readConfiguredWalletAddress(options);

    assert.equal(loadedPrivateKey, new Wallet(PRIVATE_KEY_A).privateKey);
    assert.equal(loadedAddress, new Wallet(PRIVATE_KEY_A).address);
  });
});

test("missing keychain secret fails with KEYCHAIN_SECRET_NOT_FOUND", async () => {
  await withTempConfigDir(async (configDir) => {
    const keychain = createMemoryKeychain();
    const options = {
      keychain,
      paths: { configDir }
    };

    await configureWalletFromSecret("private-key", PRIVATE_KEY_A, options);
    keychain._setSecretForTest(undefined);
    __setWalletStoreTestOverrides(undefined);

    await assert.rejects(
      () => loadConfiguredWalletPrivateKey(options),
      (error) => error?.code === "KEYCHAIN_SECRET_NOT_FOUND"
    );
  });
});

test("wrong keychain secret fails decryption", async () => {
  await withTempConfigDir(async (configDir) => {
    const keychain = createMemoryKeychain();
    const options = {
      keychain,
      paths: { configDir }
    };

    await configureWalletFromSecret("private-key", PRIVATE_KEY_A, options);
    keychain._setSecretForTest("totally-wrong-secret");
    __setWalletStoreTestOverrides(undefined);

    await assert.rejects(
      () => loadConfiguredWalletPrivateKey(options),
      /Failed to decrypt configured wallet/
    );
  });
});

test("legacy wallet format is rejected with LEGACY_WALLET_FORMAT", async () => {
  await withTempConfigDir(async (configDir) => {
    const walletFilePath = path.join(configDir, "wallet.enc.json");
    const legacyPayload = {
      version: 1,
      algorithm: "aes-256-gcm",
      importedFrom: "private-key",
      address: "0x0000000000000000000000000000000000000000",
      createdAt: new Date().toISOString(),
      iv: "AAAAAAAAAAAAAAAA",
      authTag: "AAAAAAAAAAAAAAAAAAAAAA==",
      ciphertext: "AAAAAAAAAA=="
    };

    await writeFile(walletFilePath, JSON.stringify(legacyPayload, null, 2));

    const options = {
      keychain: createMemoryKeychain("secret"),
      paths: { configDir }
    };

    await assert.rejects(
      () => loadConfiguredWalletPrivateKey(options),
      (error) => error?.code === "LEGACY_WALLET_FORMAT"
    );

    await assert.rejects(
      () => readConfiguredWalletAddress(options),
      (error) => error?.code === "LEGACY_WALLET_FORMAT"
    );
  });
});

test("setup overwrite path rewrites encrypted wallet payload", async () => {
  await withTempConfigDir(async (configDir) => {
    const keychain = createMemoryKeychain();
    const options = {
      keychain,
      paths: { configDir }
    };

    await configureWalletFromSecret("private-key", PRIVATE_KEY_A, options);
    const firstFile = await readFile(walletStoragePath(options), "utf8");

    await configureWalletFromSecret("private-key", PRIVATE_KEY_B, options);
    __setWalletStoreTestOverrides(undefined);

    const secondFile = await readFile(walletStoragePath(options), "utf8");
    const loadedPrivateKey = await loadConfiguredWalletPrivateKey(options);

    assert.notEqual(firstFile, secondFile);
    assert.equal(loadedPrivateKey, new Wallet(PRIVATE_KEY_B).privateKey);
  });
});
