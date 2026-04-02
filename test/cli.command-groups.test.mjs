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
  { args: ["ob"], commandPath: "myriad ob", subcommands: ["markets", "limit", "market", "orders", "positions"] },
  { args: ["ob", "markets"], commandPath: "myriad ob markets", subcommands: ["list", "show", "orderbook", "trades"] },
  { args: ["ob", "positions"], commandPath: "myriad ob positions", subcommands: ["list", "split", "merge", "redeem"] },
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
