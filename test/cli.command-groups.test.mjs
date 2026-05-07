import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distEntry = path.join(repoRoot, "dist/index.js");

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const commandCases = [
  { args: ["markets"], commandPath: "myriad markets", subcommands: ["list", "show"] },
  { args: ["wallet"], commandPath: "myriad wallet", subcommands: ["setup", "deposit", "balances"] },
  { args: ["swap"], commandPath: "myriad swap", subcommands: ["stable"] },
  { args: ["trade"], commandPath: "myriad trade", subcommands: ["buy", "sell"] },
  { args: ["ob"], commandPath: "myriad ob", subcommands: ["markets", "events", "limit", "market", "orders", "positions"] },
  { args: ["ob", "markets"], commandPath: "myriad ob markets", subcommands: ["list", "show", "orderbook", "trades"] },
  { args: ["ob", "events"], commandPath: "myriad ob events", subcommands: ["list", "show", "orderbook", "actions"] },
  { args: ["ob", "positions"], commandPath: "myriad ob positions", subcommands: ["list", "neg-risk", "split", "merge", "redeem"] },
  { args: ["ob", "positions", "neg-risk"], commandPath: "myriad ob positions neg-risk", subcommands: ["split", "merge"] },
  { args: ["claim"], commandPath: "myriad claim", subcommands: ["winnings", "voided", "all"] },
  { args: ["skills"], commandPath: "myriad skills", subcommands: ["install"] }
];

for (const commandCase of commandCases) {
  test(`${commandCase.commandPath} shows available subcommands`, async () => {
    const result = await runCli(commandCase.args);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const output = result.stdout;
    assert.match(output, new RegExp(`^${escapeRegExp(commandCase.commandPath)} \\(myriad v\\d+\\.\\d+\\.\\d+\\)$`, "m"));
    assert.match(output, /Available subcommands:/);
    for (const subcommand of commandCase.subcommands) {
      assert.match(output, new RegExp(`\\b${escapeRegExp(subcommand)}\\b`));
    }
    assert.match(
      output,
      new RegExp(`Run \`${escapeRegExp(commandCase.commandPath)} <subcommand> --help\` for details\\.`)
    );
  });
}

test("myriad ob orders cancel help shows single, all, market, and batch modes", async () => {
  const result = await runCli(["ob", "orders", "cancel", "--help"]);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Usage: myriad ob orders cancel/);
  assert.match(result.stdout, /\[orderHash\]/);
  assert.match(result.stdout, /\ball\b/);
  assert.match(result.stdout, /\bmarket\b/);
  assert.match(result.stdout, /\bbatch\b/);
});

test("myriad ob orders cancel all help keeps market selector compatibility", async () => {
  const result = await runCli(["ob", "orders", "cancel", "all", "--help"]);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /--market-id <id>/);
  assert.match(result.stdout, /--market-slug <slug>/);
});

test("myriad ob orders cancel all dry-run returns a local payload without hitting the API", async () => {
  const result = await runCli([
    "--private-key",
    "0x59c6995e998f97a5a0044966f094538e3f5ed6a45d8f4d35f7f510f0f4f3f0f0",
    "--json",
    "ob",
    "orders",
    "cancel",
    "all",
    "--dry-run"
  ]);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /"dryRun": true/);
  assert.match(result.stdout, /"cancelAllRequest"/);
  assert.match(result.stdout, /"signature": "0x[0-9a-f]{130}"/i);
});
