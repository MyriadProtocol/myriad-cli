export type AllowancePreference =
  | {
      kind: "required";
    }
  | {
      kind: "unlimited";
    }
  | {
      kind: "custom";
      amount: string;
    };

export const UNLIMITED_ALLOWANCE_KEYWORD = "UNLIMITED";

function isNumericAmount(input: string): boolean {
  return /^\d+(\.\d+)?$/.test(input);
}

function isZeroAmount(input: string): boolean {
  return /^0+(\.0+)?$/.test(input);
}

export function parseAllowancePreference(input?: string): AllowancePreference {
  if (!input) {
    return { kind: "required" };
  }

  const normalized = input.trim();
  if (normalized.length === 0) {
    return { kind: "required" };
  }

  if (normalized.toUpperCase() === UNLIMITED_ALLOWANCE_KEYWORD) {
    return { kind: "unlimited" };
  }

  if (!isNumericAmount(normalized)) {
    throw new Error(`Invalid allowance value "${input}". Use a positive decimal amount or "${UNLIMITED_ALLOWANCE_KEYWORD}".`);
  }

  if (isZeroAmount(normalized)) {
    throw new Error(`Allowance must be greater than zero, or "${UNLIMITED_ALLOWANCE_KEYWORD}".`);
  }

  return {
    kind: "custom",
    amount: normalized
  };
}

export function resolveAllowancePreference(actionLevel?: string, globalLevel?: string): AllowancePreference {
  return parseAllowancePreference(actionLevel ?? globalLevel);
}
