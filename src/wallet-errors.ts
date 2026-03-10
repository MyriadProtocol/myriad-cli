export type WalletErrorCode =
  | "KEYCHAIN_UNAVAILABLE"
  | "KEYCHAIN_ACCESS_DENIED"
  | "KEYCHAIN_SECRET_NOT_FOUND"
  | "UNSUPPORTED_PLATFORM"
  | "LEGACY_WALLET_FORMAT";

export class WalletStorageError extends Error {
  readonly code: WalletErrorCode;
  readonly cause?: unknown;

  constructor(code: WalletErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "WalletStorageError";
    this.code = code;
    this.cause = options?.cause;
  }
}

export function isWalletStorageError(error: unknown): error is WalletStorageError {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      "code" in error &&
      (error as { name: unknown }).name === "WalletStorageError"
  );
}
