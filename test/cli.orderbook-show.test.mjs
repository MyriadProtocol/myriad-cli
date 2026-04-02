import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distEntry = path.join(repoRoot, "dist/index.js");

function processEnvAsRecord() {
  return Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === "string"));
}

function baseCliEnv(overrides = {}) {
  const env = processEnvAsRecord();
  for (const key of Object.keys(env)) {
    if (key.startsWith("MYRIAD_")) {
      delete env[key];
    }
  }
  delete env.PRIVATE_KEY;
  delete env.XDG_CONFIG_HOME;

  return {
    ...env,
    ...overrides
  };
}

function runCli(args, envOverrides = {}, cwd = repoRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [distEntry, ...args], {
      cwd,
      env: baseCliEnv(envOverrides)
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

async function withTempDir(prefix, callback) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeMockFetchModule(dir) {
  const modulePath = path.join(dir, "mock-fetch.mjs");
  const source = `
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method ?? "GET";

  if (method === "GET" && url.pathname === "/markets/42") {
    const actualNetworkId = url.searchParams.get("network_id");
    const actualExecutionMode = url.searchParams.get("execution_mode");
    if (actualNetworkId !== "56" || actualExecutionMode !== "1") {
      return new Response(JSON.stringify({
        error: "unexpected query",
        actualNetworkId,
        actualExecutionMode
      }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      id: 42,
      slug: "test-market",
      title: "Will it rain?",
      state: "open",
      networkId: 56,
      executionMode: 1,
      outcomes: []
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ error: "Unhandled route", method, pathname: url.pathname, search: url.search }), {
    status: 404,
    headers: { "content-type": "application/json" }
  });
};
`;
  await writeFile(modulePath, source, "utf8");
  return modulePath;
}

test("myriad ob markets show passes execution_mode=1 on market detail requests", async () => {
  await withTempDir("myriad-cli-ob-show-", async (cwd) => {
    const mockFetchModule = await writeMockFetchModule(cwd);
    const result = await runCli(
      [
        "--api-base-url",
        "https://mock.myriad.local",
        "--json",
        "ob",
        "markets",
        "show",
        "42"
      ],
      {
        NODE_OPTIONS: `--import=${mockFetchModule}`
      },
      cwd
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.id, 42);
    assert.equal(parsed.executionMode, 1);
  });
});
