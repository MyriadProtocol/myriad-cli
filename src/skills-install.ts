import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type InstallOptions = {
  force?: boolean;
};

type InstallResult = {
  ok: boolean;
  target: string;
  destination: string;
  filesWritten: string[];
  filesSkipped: string[];
};

function collectFiles(dir: string, base: string = ""): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = base ? path.join(base, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectFiles(path.join(dir, entry.name), relative));
    } else {
      files.push(relative);
    }
  }
  return files;
}

function copyTree(
  sourceDir: string,
  destDir: string,
  options: InstallOptions
): { written: string[]; skipped: string[] } {
  const files = collectFiles(sourceDir);
  const written: string[] = [];
  const skipped: string[] = [];

  for (const relative of files) {
    const src = path.join(sourceDir, relative);
    const dest = path.join(destDir, relative);

    if (!options.force && fs.existsSync(dest)) {
      skipped.push(relative);
      continue;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    written.push(relative);
  }

  return { written, skipped };
}

export function installClaudeCodeSkills(targetDir: string, options: InstallOptions): InstallResult {
  const sourceSkills = path.join(PACKAGE_ROOT, ".claude", "skills");
  const destSkills = path.join(targetDir, ".claude", "skills");

  if (!fs.existsSync(sourceSkills)) {
    return { ok: false, target: "claude", destination: destSkills, filesWritten: [], filesSkipped: [] };
  }

  const { written, skipped } = copyTree(sourceSkills, destSkills, options);

  return { ok: true, target: "claude", destination: destSkills, filesWritten: written, filesSkipped: skipped };
}

export function installOpenClawSkills(targetDir: string, options: InstallOptions): InstallResult {
  const sourceSkills = path.join(PACKAGE_ROOT, "skills");
  const destSkills = path.join(targetDir);

  if (!fs.existsSync(sourceSkills)) {
    return { ok: false, target: "openclaw", destination: destSkills, filesWritten: [], filesSkipped: [] };
  }

  const { written, skipped } = copyTree(sourceSkills, destSkills, options);

  return { ok: true, target: "openclaw", destination: destSkills, filesWritten: written, filesSkipped: skipped };
}

export function installCodexSkills(targetDir: string, options: InstallOptions): InstallResult {
  const sourceSkills = path.join(PACKAGE_ROOT, "skills");
  const destSkills = path.join(targetDir, "skills");

  if (!fs.existsSync(sourceSkills)) {
    return { ok: false, target: "codex", destination: destSkills, filesWritten: [], filesSkipped: [] };
  }

  const { written, skipped } = copyTree(sourceSkills, destSkills, options);

  return { ok: true, target: "codex", destination: destSkills, filesWritten: written, filesSkipped: skipped };
}

function openClawSkillsDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return path.join(home, ".openclaw", "skills");
}

function codexSkillsHome(): string {
  const configuredHome = process.env.CODEX_HOME?.trim();
  if (configuredHome) {
    return configuredHome;
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return path.join(home, ".codex");
}

export function runSkillsInstall(
  target: string,
  options: InstallOptions
): InstallResult[] {
  const results: InstallResult[] = [];

  if (target === "claude" || target === "all") {
    results.push(installClaudeCodeSkills(process.cwd(), options));
  }

  if (target === "openclaw" || target === "all") {
    results.push(installOpenClawSkills(openClawSkillsDir(), options));
  }

  if (target === "codex" || target === "all") {
    results.push(installCodexSkills(codexSkillsHome(), options));
  }

  return results;
}

export function formatInstallSummary(results: InstallResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    if (!result.ok) {
      lines.push(`[${result.target}] Source skills not found. Reinstall @myriadmarkets/cli.`);
      continue;
    }

    lines.push(`[${result.target}] Installed to ${result.destination}`);

    if (result.filesWritten.length > 0) {
      lines.push(`  ${result.filesWritten.length} file(s) written.`);
    }

    if (result.filesSkipped.length > 0) {
      lines.push(`  ${result.filesSkipped.length} file(s) skipped (already exist; use --force to overwrite).`);
    }

    if (result.filesWritten.length === 0 && result.filesSkipped.length > 0) {
      lines.push("  No files were written. All skills already exist at the destination.");
    }
  }

  const hasClaudeResult = results.some((r) => r.target === "claude" && r.ok);
  if (hasClaudeResult) {
    lines.push("");
    lines.push("MCP server config for Claude Code (add to .claude.json or claude_desktop_config.json):");
    lines.push("");
    lines.push('  { "mcpServers": { "myriad": { "command": "myriad", "args": ["mcp"] } } }');
  }

  return lines.join("\n");
}
