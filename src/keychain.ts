import { spawn } from "node:child_process";
import process from "node:process";
import { WalletStorageError } from "./wallet-errors.js";

export const DEFAULT_KEYCHAIN_SERVICE = "myriad-cli";
export const DEFAULT_KEYCHAIN_ACCOUNT = "wallet-master-secret-v1";

export type KeychainBackend = "darwin-security" | "linux-secret-tool" | "unsupported";

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: {
    input?: string;
  }
) => Promise<CommandResult>;

export type KeychainAdapter = {
  backend: KeychainBackend;
  service: string;
  account: string;
  isAvailable(): Promise<boolean>;
  getSecret(): Promise<string>;
  setSecret(secret: string): Promise<void>;
  deleteSecret(): Promise<void>;
};

export type CreateKeychainAdapterOptions = {
  service?: string;
  account?: string;
  platform?: NodeJS.Platform;
  runner?: CommandRunner;
};

function containsAny(text: string, patterns: string[]): boolean {
  const lowered = text.toLowerCase();
  return patterns.some((pattern) => lowered.includes(pattern));
}

function formatProcessOutput(result: CommandResult): string {
  const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join(" ").trim();
  return details || "No additional output.";
}

async function defaultCommandRunner(
  command: string,
  args: string[],
  options: {
    input?: string;
  } = {}
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "pipe"
    });

    let stdout = "";
    let stderr = "";
    let spawnError: NodeJS.ErrnoException | undefined;

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (code) => {
      resolve({
        exitCode: typeof code === "number" ? code : -1,
        stdout,
        stderr,
        error: spawnError
      });
    });

    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

function mapUnsupportedPlatformError(platform: NodeJS.Platform): WalletStorageError {
  return new WalletStorageError(
    "UNSUPPORTED_PLATFORM",
    `OS keychain persistence is unsupported on ${platform}. v1 supports macOS and Linux.`
  );
}

function mapKeychainUnavailableError(
  backend: Exclude<KeychainBackend, "unsupported">,
  result?: CommandResult,
  cause?: unknown
): WalletStorageError {
  const output = result ? ` ${formatProcessOutput(result)}` : "";
  return new WalletStorageError(
    "KEYCHAIN_UNAVAILABLE",
    `Keychain backend (${backend}) is unavailable. Install/unlock keychain support, then run \`myriad wallet setup\`.${output}`,
    { cause }
  );
}

function mapKeychainAccessDeniedError(
  backend: Exclude<KeychainBackend, "unsupported">,
  result?: CommandResult,
  cause?: unknown
): WalletStorageError {
  const output = result ? ` ${formatProcessOutput(result)}` : "";
  return new WalletStorageError(
    "KEYCHAIN_ACCESS_DENIED",
    `Keychain access was denied or locked for backend (${backend}). Unlock/allow access and retry.${output}`,
    { cause }
  );
}

function mapKeychainSecretNotFoundError(backend: Exclude<KeychainBackend, "unsupported">): WalletStorageError {
  return new WalletStorageError(
    "KEYCHAIN_SECRET_NOT_FOUND",
    `No wallet keychain secret found in backend (${backend}). Run \`myriad wallet setup\`.`
  );
}

function isCommandMissing(result: CommandResult): boolean {
  return result.error?.code === "ENOENT";
}

function isDarwinSecretNotFound(result: CommandResult): boolean {
  if (result.exitCode === 44) {
    return true;
  }
  return containsAny(result.stderr, ["could not be found", "item not found", "errsecitemnotfound"]);
}

function isDarwinAccessDenied(result: CommandResult): boolean {
  return containsAny(result.stderr, [
    "user interaction is not allowed",
    "authorization/authentication failed",
    "not allowed",
    "operation not permitted"
  ]);
}

function isLinuxAccessDenied(result: CommandResult): boolean {
  return containsAny(result.stderr, [
    "permission denied",
    "not authorized",
    "access denied",
    "prompt dismissed",
    "cancelled",
    "locked"
  ]);
}

function isLinuxUnavailable(result: CommandResult): boolean {
  return containsAny(result.stderr, [
    "org.freedesktop.secrets",
    "cannot autolaunch d-bus",
    "failed to execute child process",
    "dbus",
    "no such secret collection",
    "g-io-error-quark"
  ]);
}

function isLinuxSecretNotFound(result: CommandResult): boolean {
  return result.exitCode !== 0 && result.stderr.trim().length === 0;
}

function createUnsupportedAdapter(platform: NodeJS.Platform, service: string, account: string): KeychainAdapter {
  return {
    backend: "unsupported",
    service,
    account,
    async isAvailable() {
      return false;
    },
    async getSecret() {
      throw mapUnsupportedPlatformError(platform);
    },
    async setSecret() {
      throw mapUnsupportedPlatformError(platform);
    },
    async deleteSecret() {
      throw mapUnsupportedPlatformError(platform);
    }
  };
}

function createDarwinAdapter(service: string, account: string, runner: CommandRunner): KeychainAdapter {
  const backend: Exclude<KeychainBackend, "linux-secret-tool" | "unsupported"> = "darwin-security";

  return {
    backend,
    service,
    account,
    async isAvailable() {
      const result = await runner("security", ["find-generic-password", "-a", account, "-s", service, "-w"]);
      if (isCommandMissing(result)) {
        return false;
      }
      if (result.exitCode === 0 || isDarwinSecretNotFound(result)) {
        return true;
      }
      if (isDarwinAccessDenied(result)) {
        return false;
      }
      return true;
    },
    async getSecret() {
      const result = await runner("security", ["find-generic-password", "-a", account, "-s", service, "-w"]);
      if (isCommandMissing(result)) {
        throw mapKeychainUnavailableError(backend, result, result.error);
      }
      if (result.exitCode === 0) {
        return result.stdout.trimEnd();
      }
      if (isDarwinSecretNotFound(result)) {
        throw mapKeychainSecretNotFoundError(backend);
      }
      if (isDarwinAccessDenied(result)) {
        throw mapKeychainAccessDeniedError(backend, result);
      }
      throw mapKeychainUnavailableError(backend, result);
    },
    async setSecret(secret: string) {
      const result = await runner("security", ["add-generic-password", "-U", "-a", account, "-s", service, "-w", secret]);
      if (isCommandMissing(result)) {
        throw mapKeychainUnavailableError(backend, result, result.error);
      }
      if (result.exitCode === 0) {
        return;
      }
      if (isDarwinAccessDenied(result)) {
        throw mapKeychainAccessDeniedError(backend, result);
      }
      throw mapKeychainUnavailableError(backend, result);
    },
    async deleteSecret() {
      const result = await runner("security", ["delete-generic-password", "-a", account, "-s", service]);
      if (isCommandMissing(result)) {
        throw mapKeychainUnavailableError(backend, result, result.error);
      }
      if (result.exitCode === 0 || isDarwinSecretNotFound(result)) {
        return;
      }
      if (isDarwinAccessDenied(result)) {
        throw mapKeychainAccessDeniedError(backend, result);
      }
      throw mapKeychainUnavailableError(backend, result);
    }
  };
}

function createLinuxAdapter(service: string, account: string, runner: CommandRunner): KeychainAdapter {
  const backend: Exclude<KeychainBackend, "darwin-security" | "unsupported"> = "linux-secret-tool";
  const attrs = ["service", service, "account", account];

  return {
    backend,
    service,
    account,
    async isAvailable() {
      const result = await runner("secret-tool", ["lookup", ...attrs]);
      if (isCommandMissing(result)) {
        return false;
      }
      if (result.exitCode === 0 || isLinuxSecretNotFound(result)) {
        return true;
      }
      if (isLinuxUnavailable(result) || isLinuxAccessDenied(result)) {
        return false;
      }
      return true;
    },
    async getSecret() {
      const result = await runner("secret-tool", ["lookup", ...attrs]);
      if (isCommandMissing(result)) {
        throw mapKeychainUnavailableError(backend, result, result.error);
      }
      if (result.exitCode === 0) {
        return result.stdout.trimEnd();
      }
      if (isLinuxAccessDenied(result)) {
        throw mapKeychainAccessDeniedError(backend, result);
      }
      if (isLinuxSecretNotFound(result)) {
        throw mapKeychainSecretNotFoundError(backend);
      }
      throw mapKeychainUnavailableError(backend, result);
    },
    async setSecret(secret: string) {
      const result = await runner(
        "secret-tool",
        ["store", "--label", "myriad-cli wallet secret", ...attrs],
        {
          input: secret
        }
      );
      if (isCommandMissing(result)) {
        throw mapKeychainUnavailableError(backend, result, result.error);
      }
      if (result.exitCode === 0) {
        return;
      }
      if (isLinuxAccessDenied(result)) {
        throw mapKeychainAccessDeniedError(backend, result);
      }
      throw mapKeychainUnavailableError(backend, result);
    },
    async deleteSecret() {
      const result = await runner("secret-tool", ["clear", ...attrs]);
      if (isCommandMissing(result)) {
        throw mapKeychainUnavailableError(backend, result, result.error);
      }
      if (result.exitCode === 0 || isLinuxSecretNotFound(result)) {
        return;
      }
      if (isLinuxAccessDenied(result)) {
        throw mapKeychainAccessDeniedError(backend, result);
      }
      throw mapKeychainUnavailableError(backend, result);
    }
  };
}

export function createSystemKeychainAdapter(options: CreateKeychainAdapterOptions = {}): KeychainAdapter {
  const service = options.service ?? DEFAULT_KEYCHAIN_SERVICE;
  const account = options.account ?? DEFAULT_KEYCHAIN_ACCOUNT;
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? defaultCommandRunner;

  if (platform === "darwin") {
    return createDarwinAdapter(service, account, runner);
  }
  if (platform === "linux") {
    return createLinuxAdapter(service, account, runner);
  }
  return createUnsupportedAdapter(platform, service, account);
}
