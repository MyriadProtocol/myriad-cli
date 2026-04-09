import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { chmod, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { Wallet, getAddress } from "ethers";
import {
  createSystemKeychainAdapter,
  KeychainAdapter,
  KeychainBackend
} from "./keychain.js";
import { isWalletStorageError, WalletStorageError } from "./wallet-errors.js";

const DEFAULT_CONFIG_DIR = path.join(homedir(), ".config", "myriad");
const DEFAULT_WALLET_FILE_NAME = "wallet.enc.json";
const LEGACY_WALLET_KEY_FILE_NAME = "wallet.key";
const WALLET_ENCRYPTION_ALGORITHM = "aes-256-gcm";
const WALLET_KDF = "scrypt";
const WALLET_KDF_PARAMS = {
  n: 262144,
  r: 8,
  p: 1
} as const;
const WALLET_KDF_MAXMEM = 1024 * 1024 * 512;
const AES_256_GCM_IV_BYTES = 12;
const AES_256_GCM_KEY_BYTES = 32;

type WalletImportSource = "private-key" | "seed-phrase";
type WalletSetupSource = WalletImportSource | "generated";
type WalletSetupMode = "create" | "import";

type ConfiguredWalletResult = {
  address: string;
  walletFile: string;
  importedFrom: WalletSetupSource;
  keychainBackend: KeychainBackend;
  keychainService: string;
  keychainAccount: string;
};

type WalletStorePaths = {
  configDir: string;
  walletFilePath: string;
  legacyWalletKeyPath: string;
};

export type WalletStoreOptions = {
  keychain?: KeychainAdapter;
  paths?: Partial<WalletStorePaths>;
};

type StoredWalletFileV2 = {
  version: 2;
  importedFrom: WalletSetupSource;
  address: string;
  createdAt: string;
  encryption: {
    cipher: "aes-256-gcm";
    kdf: "scrypt";
    kdfparams: {
      n: number;
      r: number;
      p: number;
    };
    salt: string;
    iv: string;
    tag: string;
  };
  data: string;
};

let cachedPrivateKey: string | undefined;
let testOverrides: WalletStoreOptions | undefined;

function assertInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive wallet setup requires a TTY terminal.");
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function tightenPermissions(targetPath: string, mode: number): Promise<void> {
  try {
    await chmod(targetPath, mode);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES") {
      throw error;
    }
  }
}

function mergeOptions(options?: WalletStoreOptions): WalletStoreOptions {
  return {
    ...testOverrides,
    ...options,
    paths: {
      ...(testOverrides?.paths ?? {}),
      ...(options?.paths ?? {})
    }
  };
}

function resolvePaths(options?: WalletStoreOptions): WalletStorePaths {
  const merged = mergeOptions(options);
  const configDir = merged.paths?.configDir ?? DEFAULT_CONFIG_DIR;
  return {
    configDir,
    walletFilePath: merged.paths?.walletFilePath ?? path.join(configDir, DEFAULT_WALLET_FILE_NAME),
    legacyWalletKeyPath: merged.paths?.legacyWalletKeyPath ?? path.join(configDir, LEGACY_WALLET_KEY_FILE_NAME)
  };
}

function resolveKeychain(options?: WalletStoreOptions): KeychainAdapter {
  const merged = mergeOptions(options);
  return merged.keychain ?? createSystemKeychainAdapter();
}

async function ensureConfigDirectory(paths: WalletStorePaths): Promise<void> {
  await mkdir(paths.configDir, { recursive: true, mode: 0o700 });
  await tightenPermissions(paths.configDir, 0o700);
}

function parseWalletJson(raw: string, walletFilePath: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Wallet file is not valid JSON: ${walletFilePath}`);
  }
}

function isLegacyWalletShape(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const value = payload as Record<string, unknown>;
  if (value.version === 1) {
    return true;
  }
  return value.algorithm === WALLET_ENCRYPTION_ALGORITHM && typeof value.ciphertext === "string";
}

function parseStoredWalletV2(payload: unknown, walletFilePath: string): StoredWalletFileV2 {
  if (!payload || typeof payload !== "object") {
    throw new Error(`Wallet file has an unsupported format: ${walletFilePath}`);
  }

  const value = payload as Partial<StoredWalletFileV2>;
  if (
    value.version !== 2 ||
    typeof value.address !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.importedFrom !== "string" ||
    !value.encryption ||
    typeof value.encryption !== "object" ||
    value.encryption.cipher !== WALLET_ENCRYPTION_ALGORITHM ||
    value.encryption.kdf !== WALLET_KDF ||
    typeof value.encryption.kdfparams?.n !== "number" ||
    typeof value.encryption.kdfparams?.r !== "number" ||
    typeof value.encryption.kdfparams?.p !== "number" ||
    typeof value.encryption.salt !== "string" ||
    typeof value.encryption.iv !== "string" ||
    typeof value.encryption.tag !== "string" ||
    typeof value.data !== "string"
  ) {
    throw new Error(`Wallet file has an unsupported format: ${walletFilePath}`);
  }

  return value as StoredWalletFileV2;
}

function normalizeImportedWallet(source: WalletImportSource, secret: string): { privateKey: string; address: string } {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    throw new Error("Wallet secret is required.");
  }

  try {
    const wallet = source === "private-key" ? new Wallet(normalizedSecret) : Wallet.fromPhrase(normalizedSecret);
    return {
      privateKey: wallet.privateKey,
      address: wallet.address
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const label = source === "private-key" ? "private key" : "seed phrase";
    throw new Error(`Invalid ${label}: ${details}`);
  }
}

function createRandomWallet(): { privateKey: string; address: string; seedPhrase: string } {
  const wallet = Wallet.createRandom();
  const seedPhrase = wallet.mnemonic?.phrase?.trim();
  if (!seedPhrase) {
    throw new Error("Failed to generate wallet seed phrase.");
  }
  return {
    privateKey: wallet.privateKey,
    address: wallet.address,
    seedPhrase
  };
}

function createLegacyWalletError(paths: WalletStorePaths): WalletStorageError {
  return new WalletStorageError(
    "LEGACY_WALLET_FORMAT",
    `Legacy wallet format detected (${paths.walletFilePath} / ${paths.legacyWalletKeyPath}). Re-run \`myriad wallet setup\`.`
  );
}

async function parseWalletPayloadFromDisk(paths: WalletStorePaths): Promise<StoredWalletFileV2> {
  const raw = await readFile(paths.walletFilePath, "utf8");
  const parsed = parseWalletJson(raw, paths.walletFilePath);

  if (isLegacyWalletShape(parsed)) {
    throw createLegacyWalletError(paths);
  }

  const value = parseStoredWalletV2(parsed, paths.walletFilePath);
  if (
    value.encryption.kdfparams.n !== WALLET_KDF_PARAMS.n ||
    value.encryption.kdfparams.r !== WALLET_KDF_PARAMS.r ||
    value.encryption.kdfparams.p !== WALLET_KDF_PARAMS.p
  ) {
    throw new Error(`Wallet file has unsupported scrypt params in ${paths.walletFilePath}.`);
  }

  return value;
}

async function deriveEncryptionKey(masterSecret: string, saltBase64: string): Promise<Buffer> {
  const salt = Buffer.from(saltBase64, "base64");
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      masterSecret,
      salt,
      AES_256_GCM_KEY_BYTES,
      {
        N: WALLET_KDF_PARAMS.n,
        r: WALLET_KDF_PARAMS.r,
        p: WALLET_KDF_PARAMS.p,
        maxmem: WALLET_KDF_MAXMEM
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Buffer.from(derivedKey));
      }
    );
  });
}

function encryptPrivateKey(privateKey: string, key: Buffer): { iv: string; tag: string; data: string } {
  const iv = randomBytes(AES_256_GCM_IV_BYTES);
  const cipher = createCipheriv(WALLET_ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: authTag.toString("base64"),
    data: ciphertext.toString("base64")
  };
}

function decryptPrivateKey(walletFile: StoredWalletFileV2, key: Buffer): string {
  try {
    const decipher = createDecipheriv(WALLET_ENCRYPTION_ALGORITHM, key, Buffer.from(walletFile.encryption.iv, "base64"));
    decipher.setAuthTag(Buffer.from(walletFile.encryption.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(walletFile.data, "base64")),
      decipher.final()
    ]).toString("utf8");
    return new Wallet(plaintext.trim()).privateKey;
  } catch {
    throw new Error(`Failed to decrypt configured wallet. Re-run \`myriad wallet setup\` to restore ${walletFile.address}.`);
  }
}

async function getOrCreateMasterSecret(keychain: KeychainAdapter): Promise<string> {
  try {
    return await keychain.getSecret();
  } catch (error) {
    if (isWalletStorageError(error) && error.code === "KEYCHAIN_SECRET_NOT_FOUND") {
      const masterSecret = randomBytes(32).toString("hex");
      await keychain.setSecret(masterSecret);
      return masterSecret;
    }
    throw error;
  }
}

async function removeLegacyKeyFile(paths: WalletStorePaths): Promise<void> {
  if (!(await pathExists(paths.legacyWalletKeyPath))) {
    return;
  }
  try {
    await unlink(paths.legacyWalletKeyPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}

function printPrompt(text: string): void {
  process.stdout.write(text);
}

async function promptInput(promptText: string, options: { hidden?: boolean } = {}): Promise<string> {
  assertInteractiveTerminal();

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const hidden = options.hidden === true;
    const stdin = process.stdin;
    const wasRaw = stdin.isTTY ? stdin.isRaw : false;

    const cleanup = () => {
      stdin.off("data", onData);
      if (stdin.isTTY) {
        stdin.setRawMode(Boolean(wasRaw));
      }
      stdin.pause();
    };

    const onData = (chunk: string | Buffer) => {
      const data = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const char of data) {
        if (char === "\u0003") {
          cleanup();
          printPrompt("\n");
          reject(new Error("Wallet setup cancelled."));
          return;
        }

        if (char === "\r" || char === "\n") {
          cleanup();
          printPrompt("\n");
          resolve(value.trim());
          return;
        }

        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            if (!hidden) {
              printPrompt("\b \b");
            }
          }
          continue;
        }

        if (char >= " ") {
          value += char;
          if (!hidden) {
            printPrompt(char);
          }
        }
      }
    };

    printPrompt(promptText);
    stdin.resume();
    stdin.setEncoding("utf8");
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    stdin.on("data", onData);
  });
}

async function confirm(promptText: string): Promise<boolean> {
  const answer = (await promptInput(promptText)).toLowerCase();
  return answer === "y" || answer === "yes";
}

async function promptWalletSetupMode(): Promise<WalletSetupMode> {
  while (true) {
    const answer = (await promptInput("Wallet setup mode [1=create wallet, 2=import existing wallet]: ")).toLowerCase();
    if (answer === "1" || answer === "create" || answer === "new" || answer === "generate") {
      return "create";
    }
    if (answer === "2" || answer === "import" || answer === "existing") {
      return "import";
    }
    printPrompt("Select 1 to create a new wallet or 2 to import an existing wallet.\n");
  }
}

async function promptWalletImportSource(): Promise<WalletImportSource> {
  while (true) {
    const answer = (await promptInput("Import source [1=private key, 2=seed phrase]: ")).toLowerCase();
    if (answer === "1" || answer === "private" || answer === "private-key" || answer === "private key") {
      return "private-key";
    }
    if (answer === "2" || answer === "seed" || answer === "seed-phrase" || answer === "seed phrase") {
      return "seed-phrase";
    }
    printPrompt("Select 1 for private key or 2 for seed phrase.\n");
  }
}

async function assertNotLegacyByKeyFile(paths: WalletStorePaths): Promise<void> {
  if (await pathExists(paths.walletFilePath)) {
    return;
  }
  if (await pathExists(paths.legacyWalletKeyPath)) {
    throw createLegacyWalletError(paths);
  }
}

export function walletStoragePath(options?: WalletStoreOptions): string {
  return resolvePaths(options).walletFilePath;
}

export async function hasConfiguredWallet(options?: WalletStoreOptions): Promise<boolean> {
  const paths = resolvePaths(options);
  return pathExists(paths.walletFilePath);
}

export async function readConfiguredWalletAddress(options?: WalletStoreOptions): Promise<string | undefined> {
  const paths = resolvePaths(options);
  await assertNotLegacyByKeyFile(paths);

  if (!(await pathExists(paths.walletFilePath))) {
    return undefined;
  }

  const storedWallet = await parseWalletPayloadFromDisk(paths);
  return getAddress(storedWallet.address);
}

export async function loadConfiguredWalletPrivateKey(options?: WalletStoreOptions): Promise<string | undefined> {
  if (cachedPrivateKey) {
    return cachedPrivateKey;
  }

  const paths = resolvePaths(options);
  await assertNotLegacyByKeyFile(paths);

  if (!(await pathExists(paths.walletFilePath))) {
    return undefined;
  }

  const keychain = resolveKeychain(options);
  const walletFile = await parseWalletPayloadFromDisk(paths);

  const masterSecret = await keychain.getSecret();
  const encryptionKey = await deriveEncryptionKey(masterSecret, walletFile.encryption.salt);
  const privateKey = decryptPrivateKey(walletFile, encryptionKey);

  const walletAddress = new Wallet(privateKey).address;
  if (walletAddress.toLowerCase() !== walletFile.address.toLowerCase()) {
    throw new Error(`Configured wallet address mismatch in ${paths.walletFilePath}. Re-run \`myriad wallet setup\`.`);
  }

  cachedPrivateKey = privateKey;
  return privateKey;
}

async function configureWalletFromPrivateKey(
  source: WalletSetupSource,
  privateKey: string,
  options?: WalletStoreOptions
): Promise<ConfiguredWalletResult> {
  const paths = resolvePaths(options);
  const keychain = resolveKeychain(options);

  await ensureConfigDirectory(paths);

  let wallet: Wallet;
  try {
    wallet = new Wallet(privateKey.trim());
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid private key: ${details}`);
  }
  const masterSecret = await getOrCreateMasterSecret(keychain);
  const salt = randomBytes(32).toString("base64");
  const encryptionKey = await deriveEncryptionKey(masterSecret, salt);
  const encrypted = encryptPrivateKey(wallet.privateKey, encryptionKey);

  const payload: StoredWalletFileV2 = {
    version: 2,
    importedFrom: source,
    address: wallet.address,
    createdAt: new Date().toISOString(),
    encryption: {
      cipher: WALLET_ENCRYPTION_ALGORITHM,
      kdf: WALLET_KDF,
      kdfparams: {
        n: WALLET_KDF_PARAMS.n,
        r: WALLET_KDF_PARAMS.r,
        p: WALLET_KDF_PARAMS.p
      },
      salt,
      iv: encrypted.iv,
      tag: encrypted.tag
    },
    data: encrypted.data
  };

  await writeFile(paths.walletFilePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  await tightenPermissions(paths.walletFilePath, 0o600);
  await removeLegacyKeyFile(paths);
  cachedPrivateKey = wallet.privateKey;

  return {
    address: wallet.address,
    walletFile: paths.walletFilePath,
    importedFrom: source,
    keychainBackend: keychain.backend,
    keychainService: keychain.service,
    keychainAccount: keychain.account
  };
}

export async function configureWalletFromSecret(
  source: WalletImportSource,
  secret: string,
  options?: WalletStoreOptions
): Promise<ConfiguredWalletResult> {
  const wallet = normalizeImportedWallet(source, secret);
  return configureWalletFromPrivateKey(source, wallet.privateKey, options);
}

export async function configureGeneratedWallet(options?: WalletStoreOptions): Promise<ConfiguredWalletResult & { seedPhrase: string }> {
  const generated = createRandomWallet();
  const result = await configureWalletFromPrivateKey("generated", generated.privateKey, options);
  return {
    ...result,
    seedPhrase: generated.seedPhrase
  };
}

export async function setupWalletInteractive(options?: WalletStoreOptions): Promise<{
  address: string;
  walletFile: string;
  importedFrom: WalletSetupSource;
  keychainBackend: KeychainBackend;
  keychainService: string;
  keychainAccount: string;
}> {
  assertInteractiveTerminal();

  const paths = resolvePaths(options);
  await ensureConfigDirectory(paths);

  if (await pathExists(paths.walletFilePath)) {
    const shouldOverwrite = await confirm(`Wallet already exists at ${paths.walletFilePath}. Overwrite? [y/N]: `);
    if (!shouldOverwrite) {
      throw new Error("Wallet setup cancelled.");
    }
  }

  const setupMode = await promptWalletSetupMode();
  if (setupMode === "create") {
    const generated = createRandomWallet();
    printPrompt("\nNew wallet generated.\n");
    printPrompt(`Address: ${generated.address}\n`);
    printPrompt(`Seed phrase (store this securely): ${generated.seedPhrase}\n`);
    const acknowledged = await confirm("I have saved the seed phrase. Continue? [y/N]: ");
    if (!acknowledged) {
      throw new Error("Wallet setup cancelled.");
    }
    return configureWalletFromPrivateKey("generated", generated.privateKey, options);
  }

  const source = await promptWalletImportSource();
  const secretPrompt = source === "private-key" ? "Private key: " : "Seed phrase: ";
  const secret = await promptInput(secretPrompt, { hidden: true });
  return configureWalletFromSecret(source, secret, options);
}

export function __setWalletStoreTestOverrides(overrides?: WalletStoreOptions): void {
  testOverrides = overrides;
  cachedPrivateKey = undefined;
}

export const __walletStoreInternals = {
  parseStoredWalletV2
};
