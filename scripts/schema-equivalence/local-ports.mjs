/** Real local bindings, with explicit injectable boundaries for synthetic tests. */
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { Client, neonConfig } from "@neondatabase/serverless";
import { introspectSchema } from "../../lib/schema/introspect.ts";
import { diffSchemas } from "../../lib/schema/diff.ts";
import { redactSecrets } from "../../lib/security/redact-secrets.ts";
import { parseRequest, LIMITS } from "./contract.mjs";
import { buildManifest } from "./manifest.mjs";
import { createTargetRegistry } from "./target.mjs";
import { createNeonPort } from "./neon-port.mjs";

const failure = (code) => Object.assign(new Error(code), { code });
const osVariable =
  /^(path|systemroot|windir|comspec|pathext|temp|tmp|userprofile|appdata|localappdata|programfiles|programfiles\(x86\)|programdata|number_of_processors|processor_architecture|home|lang|lc_all)$/i;
const authSql =
  "create schema if not exists auth; " +
  "create table if not exists auth.users (id uuid primary key); " +
  "create or replace function auth.uid() returns uuid language sql stable as " +
  "$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;";
function commandOptions(root, env) {
  return {
    cwd: root,
    env,
    shell: false,
    timeout: LIMITS.subprocessMs,
    maxBuffer: LIMITS.subprocessBytes,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  };
}
function osEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) => osVariable.test(key) && typeof value === "string",
    ),
  );
}

/** Read-only preflight for the CLI, usable before any credential is obtained. */
export function inspectLocalManifest(options) {
  try {
    const { root, sourceSha, boundaries = {} } = options;
    if (
      typeof root !== "string" ||
      !path.isAbsolute(root) ||
      !/^[a-f0-9]{40}$/.test(sourceSha)
    )
      throw failure("invalid_input");
    const exec = boundaries.execFile ?? execFileSync;
    const opts = commandOptions(root, osEnv(boundaries.env ?? process.env));
    const head = exec("git", ["rev-parse", "HEAD"], opts).trim();
    const status = exec(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      opts,
    ).trim();
    if (head !== sourceSha || status !== "") throw failure("invalid_input");
    return buildManifest({
      root,
      sourceSha,
      listFiles: boundaries.listFiles ?? readdirSync,
      readFile: boundaries.readFile ?? readFileSync,
      realpath: boundaries.realpath ?? realpathSync,
    });
  } catch {
    throw failure("invalid_input");
  }
}

/**
 * No Client is constructed until a URI-bound same-process handle is consumed.
 * Construction validates clean HEAD and actual file bytes before the Neon port.
 */
export function createLocalPorts(options) {
  try {
    const { root, token, request: value, fetch, boundaries = {} } = options;
    const request = parseRequest(value);
    const manifest = () =>
      inspectLocalManifest({ root, sourceSha: request.sourceSha, boundaries });
    const pinned = manifest();
    if (pinned.hash !== request.manifestHash) throw failure("invalid_input");
    const registry = createTargetRegistry(request);
    const now = boundaries.now ?? Date.now;
    const neon = (boundaries.neonFactory ?? createNeonPort)({
      token,
      fetch,
      now,
    });
    const exec = boundaries.execFile ?? execFileSync;
    const readFile = boundaries.readFile ?? readFileSync;
    const ClientConstructor = boundaries.Client ?? Client;
    const baseEnv = osEnv(boundaries.env ?? process.env);
    function uri(handle) {
      registry.cleanupCandidate(handle);
      if (typeof handle.connectionUri !== "string")
        throw failure("identity_unavailable");
      return handle.connectionUri;
    }
    async function withClient(handle, fn) {
      let client;
      try {
        const connectionString = uri(handle);
        neonConfig.webSocketConstructor = globalThis.WebSocket;
        client = new ClientConstructor({ connectionString });
        // The driver can emit a FATAL error containing credentials after deletion.
        client.on("error", () => {});
        await client.connect();
        return await fn(client);
      } catch (error) {
        if (
          [
            "identity_mismatch",
            "identity_unavailable",
            "protected_target",
            "invalid_input",
          ].includes(error?.code)
        )
          throw failure(error.code);
        throw failure("operation_failed");
      } finally {
        if (client) {
          try {
            await client.end();
          } catch {
            /* consumed, never print driver state */
          }
        }
      }
    }
    function migrate(handle, dryRun = false) {
      const env = {
        ...baseEnv,
        NODE_ENV: "test",
        NEXT_TELEMETRY_DISABLED: "1",
        MIGRATE_DATABASE_URL: uri(handle),
      };
      try {
        const output = exec(
          process.execPath,
          ["scripts/migrate.ts", ...(dryRun ? ["--dry-run"] : [])],
          commandOptions(root, env),
        );
        return {
          ok: true,
          output: redactSecrets(typeof output === "string" ? output : ""),
        };
      } catch {
        return { ok: false, output: "" };
      }
    }
    return {
      origin: boundaries.origin ?? "live",
      now,
      runId: boundaries.runId ?? (() => randomBytes(16).toString("hex")),
      manifest,
      registry,
      neon,
      reset: (handle, _side, onSession) =>
        withClient(handle, async (client) => {
          const { rows } = await client.query(
            "select current_setting('neon.project_id', true) as project_id, " +
              "current_setting('neon.branch_id', true) as branch_id, current_database() as database, current_user as role",
          );
          const row = rows[0];
          const observed = {
            projectId: row?.project_id ?? null,
            branchId: row?.branch_id ?? null,
            database: row?.database ?? null,
            role: row?.role ?? null,
          };
          onSession(observed);
          registry.assertSession(handle, observed);
          await client.query(
            "drop schema public cascade; create schema public;",
          );
          await client.query(authSql);
        }),
      applyMigrations: async (handle) => {
        if (!migrate(handle).ok) throw failure("operation_failed");
      },
      applyBaseline: (handle, expected) =>
        withClient(handle, async (client) => {
          // Recheck the raw baseline bytes immediately before substituting its hash.
          const raw = readFile(path.join(root, expected.baseline.path));
          if (
            !(raw instanceof Uint8Array) ||
            createHash("sha256").update(raw).digest("hex") !==
              expected.baseline.sha256
          )
            throw failure("operation_failed");
          const sql = Buffer.from(raw)
            .toString("utf8")
            .replaceAll(
              ":'baseline_checksum'",
              `'${expected.baseline.sha256}'`,
            );
          await client.query(sql);
        }),
      ledger: (handle) =>
        withClient(
          handle,
          async (client) =>
            (
              await client.query(
                "select filename, checksum from public.schema_migrations order by filename",
              )
            ).rows,
        ),
      introspect: (handle) =>
        withClient(handle, boundaries.introspect ?? introspectSchema),
      diff: boundaries.diff ?? diffSchemas,
      dryRun: async (handle) => migrate(handle, true),
    };
  } catch {
    throw failure("invalid_input");
  }
}
