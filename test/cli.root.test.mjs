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

test("running without a subcommand shows version and command list", async () => {
  const result = await runCli([]);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");

  const output = result.stdout;
  assert.match(output, /^myriad v\d+\.\d+\.\d+/m);
  assert.match(output, /Available commands:/);
  assert.match(output, /markets/);
  assert.match(output, /trade/);
  assert.match(output, /wallet/);
  assert.match(output, /Run `myriad <command> --help` for details\./);
});
