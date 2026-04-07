import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntimeConfig } from "../dist/config.js";

const DEFAULT_PM = "0x39E66eE6b2ddaf4DEfDEd3038E0162180dbeF340";
const DEFAULT_QUERIER = "0xDeFb36c47754D2e37d44b8b8C647D4D643e03bAd";
const DEFAULT_COLLATERAL = "0x55d398326f99059fF775485246999027B3197955";

test("MYRIAD_PRIVATE_KEY takes precedence over legacy PRIVATE_KEY fallback", () => {
  const runtime = loadRuntimeConfig(
    {},
    {
      env: {
        MYRIAD_CHAIN_ID: "56",
        MYRIAD_RPC_URL: "https://env-rpc.example",
        MYRIAD_PM_CONTRACT: DEFAULT_PM,
        MYRIAD_PM_QUERIER_CONTRACT: DEFAULT_QUERIER,
        MYRIAD_COLLATERAL_TOKEN: DEFAULT_COLLATERAL,
        MYRIAD_PRIVATE_KEY: "0x1111111111111111111111111111111111111111111111111111111111111111",
        PRIVATE_KEY: "0x2222222222222222222222222222222222222222222222222222222222222222"
      }
    }
  );

  assert.equal(runtime.privateKey, "0x1111111111111111111111111111111111111111111111111111111111111111");
});

test("legacy PRIVATE_KEY fallback remains available for backward compatibility", () => {
  const runtime = loadRuntimeConfig(
    {},
    {
      env: {
        MYRIAD_CHAIN_ID: "56",
        MYRIAD_RPC_URL: "https://env-rpc.example",
        MYRIAD_PM_CONTRACT: DEFAULT_PM,
        MYRIAD_PM_QUERIER_CONTRACT: DEFAULT_QUERIER,
        MYRIAD_COLLATERAL_TOKEN: DEFAULT_COLLATERAL,
        PRIVATE_KEY: "0x3333333333333333333333333333333333333333333333333333333333333333"
      }
    }
  );

  assert.equal(runtime.privateKey, "0x3333333333333333333333333333333333333333333333333333333333333333");
});
