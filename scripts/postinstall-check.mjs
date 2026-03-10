#!/usr/bin/env node

import path from "node:path";
import process from "node:process";

function normalizePath(input) {
  if (!input) {
    return "";
  }

  if (process.platform === "win32") {
    return input.replace(/\//g, "\\").toLowerCase();
  }

  return input;
}

function printInstructions(binDir) {
  const shell = process.env.SHELL ?? "";

  console.warn("[myriad] Install completed, but `myriad` may not be available yet in this shell.");
  console.warn(`[myriad] Add your npm global bin directory to PATH: ${binDir}`);

  if (process.platform === "win32") {
    console.warn("[myriad] PowerShell (current session):");
    console.warn(`  $env:Path = "${binDir};" + $env:Path`);
    console.warn("[myriad] Persist for future sessions:");
    console.warn(`  setx PATH "${binDir};%PATH%"`);
  } else if (shell.includes("fish")) {
    console.warn("[myriad] fish:");
    console.warn(`  fish_add_path ${binDir}`);
  } else {
    console.warn("[myriad] bash/zsh:");
    console.warn(`  export PATH="${binDir}:$PATH"`);
    console.warn(
      `[myriad] Persist it in your profile (for example ~/.zshrc or ~/.bashrc), then restart the terminal.`
    );
  }

  console.warn("[myriad] Then run: myriad --version");
}

const isGlobalInstall =
  process.env.npm_config_global === "true" || process.env.npm_config_location === "global";

if (!isGlobalInstall) {
  process.exit(0);
}

const prefix = process.env.npm_config_prefix;
if (!prefix) {
  process.exit(0);
}

const binDir = process.platform === "win32" ? prefix : path.join(prefix, "bin");
const pathEntries = (process.env.PATH ?? "")
  .split(path.delimiter)
  .filter(Boolean)
  .map(normalizePath);

const normalizedBin = normalizePath(binDir);
const hasBinOnPath = pathEntries.includes(normalizedBin);

if (!hasBinOnPath) {
  console.warn("");
  printInstructions(binDir);
  console.warn("");
}
