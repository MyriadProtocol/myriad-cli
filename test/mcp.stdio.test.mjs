import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCP_TOOL_NAMES } from "../dist/mcp-server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function processEnvAsRecord() {
  return Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === "string"));
}

function baseMcpEnv(overrides = {}) {
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

async function withTempDir(prefix, callback) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeGlobalConfig(xdgRoot, payload) {
  const configDir = path.join(xdgRoot, "myriad");
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, "config.json"), JSON.stringify(payload, null, 2));
}

async function withMcpClient(t, envOverrides, callback, cwd = repoRoot) {
  const distEntry = path.join(repoRoot, "dist/index.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [distEntry, "mcp"],
    cwd,
    env: baseMcpEnv(envOverrides),
    stderr: "pipe"
  });

  const client = new Client({
    name: "myriad-stdio-test-client",
    version: "1.0.0"
  });

  t.after(async () => {
    await client.close();
  });

  await client.connect(transport);
  await callback(client, transport);
}

test("`myriad mcp` starts over stdio and lists tools", async (t) => {
  await withMcpClient(t, {}, async (client, transport) => {
    const stderrChunks = [];
    const stderrStream = transport.stderr;
    if (stderrStream) {
      stderrStream.on("data", (chunk) => {
        stderrChunks.push(String(chunk));
      });
    }

    const tools = await client.listTools();

    const toolNames = tools.tools.map((tool) => tool.name).sort();
    const expected = [...MCP_TOOL_NAMES].sort();
    assert.deepEqual(toolNames, expected);

    const stderrOutput = stderrChunks.join("");
    assert.equal(stderrOutput.includes("Error"), false);
  });
});

test("`myriad mcp` starts even when the global config only sets an unknown chain id", async (t) => {
  await withTempDir("myriad-mcp-config-test-", async (xdgRoot) => {
    await writeGlobalConfig(xdgRoot, {
      chainId: 999,
      rpcUrl: "https://rpc.unknown-chain.example"
    });

    await withMcpClient(
      t,
      {
        XDG_CONFIG_HOME: xdgRoot
      },
      async (client) => {
        const tools = await client.listTools();
        assert.deepEqual(
          tools.tools.map((tool) => tool.name).sort(),
          [...MCP_TOOL_NAMES].sort()
        );
      },
      xdgRoot
    );
  });
});

test("`myriad mcp` keeps env-over-global precedence", async (t) => {
  await withTempDir("myriad-mcp-config-test-", async (xdgRoot) => {
    await writeGlobalConfig(xdgRoot, {
      chainId: 999
    });

    await withMcpClient(
      t,
      {
        XDG_CONFIG_HOME: xdgRoot,
        MYRIAD_CHAIN_ID: "56"
      },
      async (client) => {
        const tools = await client.listTools();
        const toolNames = tools.tools.map((tool) => tool.name).sort();
        const expected = [...MCP_TOOL_NAMES].sort();
        assert.deepEqual(toolNames, expected);
      },
      xdgRoot
    );
  });
});
