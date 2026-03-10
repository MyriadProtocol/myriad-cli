import test from "node:test";
import assert from "node:assert/strict";
import { createSystemKeychainAdapter } from "../dist/keychain.js";

function successResult(stdout = "", stderr = "") {
  return { exitCode: 0, stdout, stderr };
}

function failureResult(exitCode, stderr = "", error) {
  return { exitCode, stdout: "", stderr, error };
}

test("darwin keychain adapter supports get/set/delete", async () => {
  const calls = [];
  const runner = async (command, args, options = {}) => {
    calls.push({ command, args, options });

    if (args[0] === "find-generic-password") {
      return successResult("top-secret\n");
    }
    if (args[0] === "add-generic-password") {
      return successResult();
    }
    if (args[0] === "delete-generic-password") {
      return successResult();
    }

    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };

  const adapter = createSystemKeychainAdapter({
    platform: "darwin",
    service: "svc",
    account: "acc",
    runner
  });

  assert.equal(await adapter.isAvailable(), true);
  assert.equal(await adapter.getSecret(), "top-secret");
  await adapter.setSecret("updated-secret");
  await adapter.deleteSecret();

  assert.equal(calls[2].args.includes("updated-secret"), true);
  assert.equal(adapter.backend, "darwin-security");
});

test("linux keychain adapter supports get/set/delete", async () => {
  const calls = [];
  const runner = async (command, args, options = {}) => {
    calls.push({ command, args, options });

    if (args[0] === "lookup") {
      return successResult("linux-secret\n");
    }
    if (args[0] === "store") {
      return successResult();
    }
    if (args[0] === "clear") {
      return successResult();
    }

    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };

  const adapter = createSystemKeychainAdapter({
    platform: "linux",
    service: "svc",
    account: "acc",
    runner
  });

  assert.equal(await adapter.isAvailable(), true);
  assert.equal(await adapter.getSecret(), "linux-secret");
  await adapter.setSecret("linux-updated");
  await adapter.deleteSecret();

  assert.equal(calls[2].options.input, "linux-updated");
  assert.equal(adapter.backend, "linux-secret-tool");
});

test("adapter reports KEYCHAIN_UNAVAILABLE when command is missing", async () => {
  const runner = async () => failureResult(-1, "", { code: "ENOENT" });
  const adapter = createSystemKeychainAdapter({
    platform: "darwin",
    runner
  });

  assert.equal(await adapter.isAvailable(), false);

  await assert.rejects(
    () => adapter.getSecret(),
    (error) => error?.code === "KEYCHAIN_UNAVAILABLE"
  );
});

test("adapter reports KEYCHAIN_ACCESS_DENIED for locked/denied keychain", async () => {
  const runner = async () => failureResult(1, "User interaction is not allowed.");
  const adapter = createSystemKeychainAdapter({
    platform: "darwin",
    runner
  });

  await assert.rejects(
    () => adapter.getSecret(),
    (error) => error?.code === "KEYCHAIN_ACCESS_DENIED"
  );
});

test("win32 backend is explicitly unsupported", async () => {
  const adapter = createSystemKeychainAdapter({
    platform: "win32"
  });

  assert.equal(await adapter.isAvailable(), false);
  assert.equal(adapter.backend, "unsupported");

  await assert.rejects(
    () => adapter.getSecret(),
    (error) => error?.code === "UNSUPPORTED_PLATFORM"
  );
});
