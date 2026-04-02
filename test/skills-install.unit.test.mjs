import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { formatInstallSummary, runSkillsInstall } from "../dist/skills-install.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distEntry = path.join(repoRoot, "dist/index.js");

function listSkillDirs(rootDir) {
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function withTempEnvAndCwd(callback) {
  const originalHome = process.env.HOME;
  const originalCodexHome = process.env.CODEX_HOME;
  const originalCwd = process.cwd();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "myriad-skills-"));
  const tempHome = path.join(tempRoot, "home");
  const tempCodexHome = path.join(tempRoot, "codex-home");
  const tempProject = path.join(tempRoot, "project");
  fs.mkdirSync(tempHome, { recursive: true });
  fs.mkdirSync(tempCodexHome, { recursive: true });
  fs.mkdirSync(tempProject, { recursive: true });

  process.env.HOME = tempHome;
  process.env.CODEX_HOME = tempCodexHome;
  process.chdir(tempProject);

  try {
    return callback({ tempRoot, tempHome, tempCodexHome, tempProject });
  } finally {
    process.chdir(originalCwd);
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [distEntry, ...args], {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === "string"))
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
      resolve({ code, stdout, stderr });
    });
  });
}

test("skills and claude skill inventories stay aligned and include myriad-orderbook", () => {
  const skillsDirs = listSkillDirs(path.join(repoRoot, "skills"));
  const claudeSkillDirs = listSkillDirs(path.join(repoRoot, ".claude", "skills"));

  assert.deepEqual(skillsDirs, claudeSkillDirs);
  assert.ok(skillsDirs.includes("myriad-orderbook"));
});

test("myriad-orderbook skill files cover the full order book workflow", () => {
  const skill = read("skills/myriad-orderbook/SKILL.md");
  const recipes = read("skills/myriad-orderbook/references/recipes.md");
  const metadata = read("skills/myriad-orderbook/agents/openai.yaml");

  assert.match(skill, /production BNB Smart Chain workflow by default/i);
  assert.match(skill, /ob markets orderbook --render/);
  assert.match(skill, /ob orders cancel all/);
  assert.match(skill, /ob positions redeem/);

  assert.match(recipes, /ob markets list/);
  assert.match(recipes, /ob limit buy/);
  assert.match(recipes, /ob market sell/);
  assert.match(recipes, /ob positions list/);
  assert.match(recipes, /ob positions split/);
  assert.match(recipes, /ob positions merge/);
  assert.match(recipes, /ob positions redeem/);

  assert.match(metadata, /display_name: "Myriad Order Book"/);
  assert.match(metadata, /place limit\/market orders/i);
});

test("existing skill docs and README cross-link orderbook and codex support", () => {
  const discovery = read("skills/myriad-market-discovery/SKILL.md");
  const trade = read("skills/myriad-trade-execution/SKILL.md");
  const claims = read("skills/myriad-claims/SKILL.md");
  const mcp = read("skills/myriad-mcp-orchestration/SKILL.md");
  const readme = read("README.md");

  assert.match(discovery, /\$myriad-orderbook/);
  assert.match(trade, /\$myriad-orderbook/);
  assert.match(claims, /ob positions redeem/);
  assert.match(mcp, /ob_orders_cancel_all/);
  assert.match(mcp, /ob_positions_redeem/);

  assert.match(readme, /skills\/myriad-orderbook\/SKILL\.md/);
  assert.match(readme, /myriad skills install --target codex/);
  assert.match(readme, /~\/\.codex\/skills/);
});

test("runSkillsInstall supports codex target and all installs include codex", () => {
  withTempEnvAndCwd(({ tempCodexHome, tempHome, tempProject }) => {
    const codexOnlyResults = runSkillsInstall("codex", { force: true });
    assert.deepEqual(codexOnlyResults.map((result) => result.target), ["codex"]);
    assert.ok(fs.existsSync(path.join(tempCodexHome, "skills", "myriad-orderbook", "SKILL.md")));

    const allResults = runSkillsInstall("all", { force: true });
    const targets = allResults.map((result) => result.target).sort();
    assert.deepEqual(targets, ["claude", "codex", "openclaw"]);

    assert.ok(fs.existsSync(path.join(tempProject, ".claude", "skills", "myriad-orderbook", "SKILL.md")));
    assert.ok(fs.existsSync(path.join(tempHome, ".openclaw", "skills", "myriad-orderbook", "SKILL.md")));
    assert.ok(fs.existsSync(path.join(tempCodexHome, "skills", "myriad-orderbook", "agents", "openai.yaml")));

    const summary = formatInstallSummary(allResults);
    assert.match(summary, /\[codex\] Installed to/);
  });
});

test("skills install help mentions codex target", async () => {
  const result = await runCli(["skills", "install", "--help"]);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Target platform: claude \| openclaw \| codex \| all/);
});
