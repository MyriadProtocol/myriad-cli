import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distEntry = path.join(repoRoot, "dist/index.js");
const PRIVATE_KEY_A = "0x59c6995e998f97a5a0044966f094538e3f5ed6a45d8f4d35f7f510f0f4f3f0f0";

function processEnvAsRecord() {
  return Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === "string"));
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [distEntry, ...args], {
      cwd: repoRoot,
      env: processEnvAsRecord()
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr
      });
    });
  });
}

test("wallet deposit prints instructions by default", async () => {
  const result = await runCli(["--private-key", PRIVATE_KEY_A, "wallet", "deposit"]);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");

  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "On BNB Chain:");
  assert.match(lines[1], /^Send BNB to 0x[0-9a-fA-F]{40} for gas\.$/);
  assert.match(
    lines[2],
    /^Send USDT \(token address 0x55d398326f99059fF775485246999027B3197955\) to 0x[0-9a-fA-F]{40} to trade\.$/
  );
});

test("wallet deposit keeps JSON output with --json", async () => {
  const result = await runCli(["--private-key", PRIVATE_KEY_A, "wallet", "deposit", "--json"]);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.chainId, 56);
  assert.equal(payload.network, "BNB Chain");
  assert.equal(payload.assets.native.symbol, "BNB");
  assert.equal(payload.assets.collateral.symbol, "USDT");
});

test("wallet deposit prints instructions with --plain", async () => {
  const result = await runCli(["--private-key", PRIVATE_KEY_A, "wallet", "deposit", "--plain"]);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");

  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "On BNB Chain:");
  assert.match(lines[1], /^Send BNB to 0x[0-9a-fA-F]{40} for gas\.$/);
  assert.match(
    lines[2],
    /^Send USDT \(token address 0x55d398326f99059fF775485246999027B3197955\) to 0x[0-9a-fA-F]{40} to trade\.$/
  );
});

test("wallet deposit uses JSON when both --json and --plain are passed", async () => {
  const result = await runCli(["--private-key", PRIVATE_KEY_A, "wallet", "deposit", "--json", "--plain"]);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.chainId, 56);
  assert.equal(payload.network, "BNB Chain");
  assert.equal(payload.assets.native.symbol, "BNB");
  assert.equal(payload.assets.collateral.symbol, "USDT");
});
