import { createHash } from "node:crypto";
import path from "node:path";
import { canonicalJson, LIMITS } from "./contract.mjs";

const BASELINE = "supabase/baseline/000_baseline_2026-08-31.sql";
const MIGRATIONS = "supabase/migrations";
const MODULES = "scripts/schema-equivalence";
const REQUIRED = [
  "scripts/schema-equivalence.mjs",
  ...["contract", "manifest", "target", "neon-port", "runner", "local-ports"].map(
    (name) => `${MODULES}/${name}.mjs`,
  ),
  "scripts/migrate.ts",
  "lib/schema/types.ts",
  "lib/schema/introspect.ts",
  "lib/schema/diff.ts",
  "lib/security/redact-secrets.ts",
  "package.json",
  "package-lock.json",
].sort();
const fail = () => { throw new Error("Invalid schema manifest"); };
const requireValue = (value) => { if (!value) fail(); };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isSha = (value, length) =>
  typeof value === "string" && value.length === length && /^[a-f0-9]+$/.test(value);
function safePath(value) {
  requireValue(
    typeof value === "string" && value.length > 0 &&
    value.length <= LIMITS.relativePath && /^[A-Za-z0-9_./-]+$/.test(value) &&
    !value.startsWith("/") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
  );
}
function exactKeys(value, names) {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  requireValue([Object.prototype, null].includes(Object.getPrototypeOf(value)));
  requireValue(Reflect.ownKeys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name)));
}
function validateManifest(value) {
  exactKeys(value, ["version", "sourceSha", "baseline", "migrations", "harness", "hash"]);
  requireValue(value.version === 1 && isSha(value.sourceSha, 40) && isSha(value.hash, 64));
  const seen = new Set();
  function entry(item) {
    exactKeys(item, ["path", "sha256"]);
    safePath(item.path);
    requireValue(isSha(item.sha256, 64) && !seen.has(item.path));
    seen.add(item.path);
  }
  entry(value.baseline);
  requireValue(value.baseline.path === BASELINE);
  function entries(items, max, allowed) {
    requireValue(Array.isArray(items) && items.length > 0 && items.length <= max);
    items.forEach((item, index) => {
      entry(item);
      requireValue(allowed(item.path));
      requireValue(index === 0 || items[index - 1].path < item.path);
    });
  }
  entries(value.migrations, LIMITS.migrations,
    (p) => path.posix.dirname(p) === MIGRATIONS && p.endsWith(".sql"));
  entries(value.harness, LIMITS.harnessFiles,
    (p) => REQUIRED.includes(p) || (path.posix.dirname(p) === MODULES && p.endsWith(".mjs")));
  requireValue(REQUIRED.every((p) => value.harness.some((item) => item.path === p)));
  const { hash: expected, ...body } = value;
  requireValue(hash(canonicalJson(body)) === expected);
  return value;
}

/**
 * Synchronous, injected filesystem ports only.
 * listFiles(absoluteDirectory): string[] of immediate entry basenames, including
 * symlink entries; no recursion, no filtering. Missing/unreadable directory throws.
 * readFile(absoluteResolvedFile): Buffer or Uint8Array of exact bytes (no encoding).
 * realpath(absolutePath): absolute canonical native path; missing paths throw.
 * root must be absolute. Git HEAD/cleanliness checks belong to the local adapter.
 */
export function buildManifest(ports) {
  try {
    const { root, sourceSha, listFiles, readFile, realpath } = ports;
    requireValue(typeof root === "string" && path.isAbsolute(root) && !root.includes("\0"));
    requireValue(isSha(sourceSha, 40));
    requireValue([listFiles, readFile, realpath].every((fn) => typeof fn === "function"));
    const resolvedRoot = realpath(root);
    requireValue(typeof resolvedRoot === "string" && path.isAbsolute(resolvedRoot) && !resolvedRoot.includes("\0"));
    function contained(candidate) {
      requireValue(typeof candidate === "string" && path.isAbsolute(candidate) && !candidate.includes("\0"));
      const relative = path.relative(resolvedRoot, candidate);
      requireValue(relative !== "" && !path.isAbsolute(relative) &&
        relative !== ".." && !relative.startsWith(".." + path.sep));
      return candidate;
    }
    function resolve(relative) {
      safePath(relative);
      return contained(realpath(path.join(resolvedRoot, relative)));
    }
    function inventory(directory, extension, max) {
      const names = listFiles(resolve(directory));
      requireValue(Array.isArray(names) && names.length <= max);
      requireValue(new Set(names).size === names.length);
      names.forEach((name) => {
        safePath(name);
        requireValue(!name.includes("/"));
      });
      return names.filter((name) => name.endsWith(extension))
        .sort().map((name) => `${directory}/${name}`);
    }
    const migrationPaths = inventory(MIGRATIONS, ".sql", LIMITS.migrations);
    const modulePaths = inventory(MODULES, ".mjs", LIMITS.harnessFiles);
    requireValue(REQUIRED.filter((p) => p.startsWith(MODULES + "/"))
      .every((p) => modulePaths.includes(p)));
    const harnessPaths = [...new Set([...REQUIRED, ...modulePaths])].sort();
    requireValue(harnessPaths.length <= LIMITS.harnessFiles);
    const entry = (relative) => {
      const bytes = readFile(resolve(relative));
      requireValue(bytes instanceof Uint8Array);
      return { path: relative, sha256: hash(bytes) };
    };
    const body = {
      version: 1, sourceSha, baseline: entry(BASELINE),
      migrations: migrationPaths.map(entry), harness: harnessPaths.map(entry),
    };
    return validateManifest({ ...body, hash: hash(canonicalJson(body)) });
  } catch {
    fail();
  }
}

/** Validate both complete inventories and hashes before exact canonical equality. */
export function assertManifest(expected, actual) {
  try {
    validateManifest(expected);
    validateManifest(actual);
    requireValue(canonicalJson(expected) === canonicalJson(actual));
  } catch {
    fail();
  }
}
