import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Wallet } from "ethers";
import { MyriadOperations } from "../dist/operations.js";
import { configureWalletFromSecret, __setWalletStoreTestOverrides } from "../dist/wallet-store.js";
import { WalletStorageError } from "../dist/wallet-errors.js";

const PRIVATE_KEY_A = "0x59c6995e998f97a5a0044966f094538e3f5ed6a45d8f4d35f7f510f0f4f3f0f0";

function createRuntime(overrides = {}) {
  return {
    apiBaseUrl: "https://api-v2.myriadprotocol.com/",
    chainId: 1,
    rpcUrl: "https://rpc.example.com",
    predictionMarketAddress: "0x39E66eE6b2ddaf4DEfDEd3038E0162180dbeF340",
    predictionMarketQuerierAddress: "0xDeFb36c47754D2e37d44b8b8C647D4D643e03bAd",
    collateralTokenAddress: "0x55d398326f99059fF775485246999027B3197955",
    usdtTokenAddress: "0x55d398326f99059fF775485246999027B3197955",
    usd1TokenAddress: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d",
    pancakeRouterV2Address: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    ...overrides
  };
}

function unavailableKeychain() {
  return {
    backend: "linux-secret-tool",
    service: "myriad-cli",
    account: "wallet-master-secret-v1",
    async isAvailable() {
      return true;
    },
    async getSecret() {
      throw new WalletStorageError("KEYCHAIN_UNAVAILABLE", "Keychain unavailable in test.");
    },
    async setSecret() {
      throw new WalletStorageError("KEYCHAIN_UNAVAILABLE", "Keychain unavailable in test.");
    },
    async deleteSecret() {
      throw new WalletStorageError("KEYCHAIN_UNAVAILABLE", "Keychain unavailable in test.");
    }
  };
}

function memoryKeychain() {
  let secret;
  return {
    backend: "linux-secret-tool",
    service: "myriad-cli",
    account: "wallet-master-secret-v1",
    async isAvailable() {
      return true;
    },
    async getSecret() {
      if (secret === undefined) {
        throw new WalletStorageError("KEYCHAIN_SECRET_NOT_FOUND", "missing");
      }
      return secret;
    },
    async setSecret(value) {
      secret = value;
    },
    async deleteSecret() {
      secret = undefined;
    }
  };
}

test("runtime private key takes precedence over configured keychain wallet", async () => {
  __setWalletStoreTestOverrides({
    keychain: unavailableKeychain(),
    paths: { configDir: path.join(tmpdir(), "myriad-wallet-ops-noop") }
  });

  const operations = new MyriadOperations({
    runtime: createRuntime({ privateKey: PRIVATE_KEY_A })
  });

  await assert.rejects(
    () =>
      operations.swapStable({
        from: "usdt",
        to: "usd1",
        amountOut: "1"
      }),
    /BNB Chain only/
  );

  __setWalletStoreTestOverrides(undefined);
});

test("configured-wallet operations fail closed when keychain is unavailable", async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "myriad-wallet-ops-test-"));
  try {
    const workingKeychain = memoryKeychain();
    const options = {
      keychain: workingKeychain,
      paths: { configDir }
    };

    await configureWalletFromSecret("private-key", PRIVATE_KEY_A, options);

    __setWalletStoreTestOverrides({
      keychain: unavailableKeychain(),
      paths: { configDir }
    });

    const operations = new MyriadOperations({
      runtime: createRuntime()
    });

    await assert.rejects(
      () =>
        operations.swapStable({
          from: "usdt",
          to: "usd1",
          amountOut: "1"
        }),
      (error) => error?.code === "KEYCHAIN_UNAVAILABLE"
    );
  } finally {
    __setWalletStoreTestOverrides(undefined);
    await rm(configDir, { recursive: true, force: true });
  }
});

test("walletDeposit returns funding instructions for configured runtime wallet", async () => {
  const operations = new MyriadOperations({
    runtime: createRuntime({
      chainId: 56,
      privateKey: PRIVATE_KEY_A
    })
  });

  const result = await operations.walletDeposit();
  const expectedWallet = new Wallet(PRIVATE_KEY_A).address;

  assert.equal(result.wallet, expectedWallet);
  assert.equal(result.chainId, 56);
  assert.equal(result.network, "BNB Chain");
  assert.equal(result.assets.native.symbol, "BNB");
  assert.equal(result.assets.collateral.symbol, "USDT");
  assert.match(result.instructions[0], /Send BNB/);
  assert.match(result.instructions[1], /collateral token/);
});
