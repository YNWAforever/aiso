import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { buildManifest } from "../../scripts/schema-equivalence/manifest.mjs";
import {
  parseEvidence,
  CLASSES,
} from "../../scripts/schema-equivalence/contract.mjs";
import { runEquivalence } from "../../scripts/schema-equivalence/runner.mjs";
import { diffSchemas } from "../../lib/schema/diff.ts";
import {
  createLocalPorts,
  inspectLocalManifest,
} from "../../scripts/schema-equivalence/local-ports.mjs";

const start = Date.parse("2026-09-08T10:00:00.123Z");
const sourceSha = "a".repeat(40);
const baseline = "supabase/baseline/000_baseline_2026-08-31.sql";
const modules = [
  "contract",
  "manifest",
  "target",
  "neon-port",
  "runner",
  "local-ports",
].map((n) => `scripts/schema-equivalence/${n}.mjs`);
const harness = [
  "scripts/schema-equivalence.mjs",
  ...modules,
  "scripts/migrate.ts",
  "lib/schema/types.ts",
  "lib/schema/introspect.ts",
  "lib/schema/diff.ts",
  "lib/security/redact-secrets.ts",
  "package.json",
  "package-lock.json",
];
const migrations = [
  "supabase/migrations/001_first.sql",
  "supabase/migrations/003_gap.sql",
];
const authSql =
  "create schema if not exists auth; " +
  "create table if not exists auth.users (id uuid primary key); " +
  "create or replace function auth.uid() returns uuid language sql stable as " +
  "$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;";
function fixture(options = {}) {
  const root = path.resolve("synthetic-root");
  const events = [],
    queries = [],
    clients = [],
    commands = [];
  const files = Object.fromEntries(
    [baseline, ...harness, ...migrations].map((p) => [
      p,
      Buffer.from(p === baseline ? "select :'baseline_checksum';" : p),
    ]),
  );
  const relative = (p) => path.relative(root, p).split(path.sep).join("/");
  const fs = {
    listFiles: (p) =>
      Object.keys(files)
        .filter((f) => path.posix.dirname(f) === relative(p))
        .map((f) => path.posix.basename(f)),
    readFile: (p) => {
      if (!files[relative(p)]) throw Error("private");
      return files[relative(p)];
    },
    realpath: (p) => p,
  };
  const manifest = buildManifest({ root, sourceSha, ...fs });
  const request = {
    version: 1,
    sourceSha,
    manifestHash: manifest.hash,
    projectId: "synthetic-project",
    parentId: "br-parent",
    database: "fixture",
    role: "fixture_owner",
    protectedBranchIds: ["br-retained"],
    protectedHosts: ["ep-retained.neon.tech"],
    sterilityReference: "synthetic-only",
  };
  let side = "A",
    registryRef,
    handleRef,
    clock = start,
    manifestReads = 0;
  const observed = () => ({
    project_id: request.projectId,
    branch_id: "br-child",
    database: request.database,
    role: request.role,
    ...(options.session?.[side] ?? {}),
  });
  class FakeClient {
    constructor(config) {
      this.config = config;
      clients.push(this);
    }
    on = vi.fn();
    async connect() {
      if (options.connectFailure)
        throw Error("postgresql://secret:password@private.invalid/db");
    }
    async end() {
      this.ended = true;
    }
    async query(sql) {
      queries.push(sql);
      if (sql.includes("neon.project_id")) return { rows: [observed()] };
      if (sql.includes("drop schema")) {
        events.push("reset" + side);
        return { rows: [] };
      }
      if (sql === authSql) {
        events.push("shim" + side);
        return { rows: [] };
      }
      if (sql.includes("select filename, checksum")) {
        let rows = migrations.map((p) => ({
          filename: path.posix.basename(p),
          checksum: null,
        }));
        if (side === "B")
          rows.unshift({
            filename: path.posix.basename(baseline),
            checksum: manifest.baseline.sha256,
          });
        if (options.ledger) rows = options.ledger(rows, side);
        return { rows };
      }
      events.push("baseline");
      return { rows: [] };
    }
  }
  const boundaries = {
    ...fs,
    diff: (a, b) => {
      events.push("compare");
      return diffSchemas(a, b);
    },
    Client: FakeClient,
    now: () => clock++,
    runId: () => "b".repeat(32),
    origin: "synthetic",
    env: {
      PATH: "os-path",
      SystemRoot: "os-root",
      DATABASE_URL: "forbidden",
      NEON_API_KEY: "forbidden",
      NODE_OPTIONS: "--env-file=.env.local",
      UNRELATED_SECRET: "forbidden",
    },
    execFile: (command, args, opts) => {
      commands.push({ command, args, opts });
      if (command === "git") {
        if (args.includes("status"))
          return options.dirty || (options.finalDirty && manifestReads === 2)
            ? " M scripts/migrate.ts\n"
            : "";
        return options.wrongHead || (options.finalHead && manifestReads === 2)
          ? "c".repeat(40)
          : sourceSha;
      }
      if (args.includes("--dry-run")) {
        events.push("dryRun");
        if (options.dryFailure)
          throw Object.assign(Error("private"), {
            stdout: "Nothing to apply",
            stderr: "secret",
          });
        return options.pending ? "Pending migrations" : "Nothing to apply";
      }
      events.push("migrate" + side);
      if (options.migrateFailure === side)
        throw Error("postgresql://secret:password@private.invalid/db");
      return "";
    },
    introspect: async () => {
      events.push("inspect" + side);
      const result = Object.fromEntries(CLASSES.map((c) => [c, {}]));
      if (side === "B" && options.diff) result.columns.extra = "value";
      side = "B";
      return result;
    },
    neonFactory: () => {
      events.push("constructNeon");
      return {
        readProject: async () => ({ projectId: request.projectId }),
        readParent: async () => {
          events.push("parent");
          return { projectId: request.projectId, id: request.parentId };
        },
        createChild: async ({ registry, name, startedAt }) => {
          events.push("create");
          registryRef = registry;
          if (options.ambiguous)
            throw Object.assign(Error("private"), {
              code: "possible_orphan",
              mutationAttempted: true,
            });
          handleRef = registry.register({
            branch: {
              id: "br-child",
              project_id: request.projectId,
              parent_id: request.parentId,
              name,
              default: false,
              protected: false,
              expires_at: new Date(
                Math.floor((startedAt + 7200000) / 1000) * 1000,
              ).toISOString(),
            },
            endpoints: [
              {
                id: "ep-child",
                branch_id: "br-child",
                host: "ep-child.neon.tech",
                type: "read_write",
              },
            ],
            name,
            startedAt,
          });
          if (options.revoked)
            throw Object.assign(Error("private"), {
              code: "possible_orphan",
              mutationAttempted: true,
            });
          return handleRef;
        },
        connectionUri: async () => {
          events.push("connection");
          if (options.uriFailure)
            throw Object.assign(Error("private"), {
              code: "identity_mismatch",
            });
          const uri =
            "postgresql://fixture_owner:synthetic-password@ep-child.neon.tech/fixture?sslmode=require";
          registryRef.register({ handle: handleRef, uri });
          return uri;
        },
        deleteChild: async () => {
          events.push("delete");
          if (
            options.deleteFailure ||
            options.revoked ||
            options.deleteOperationFailure
          )
            throw Object.assign(Error("private"), {
              mutationAttempted: options.deleteAttempted ?? !options.revoked,
              code: options.revoked
                ? "cleanup_unverified"
                : options.deleteOperationFailure
                  ? options.deleteOperationFailure
                  : "cleanup_failed",
            });
          return { attempted: true, deletionMode: "recoverable" };
        },
        confirmAbsent: async () => {
          events.push("absence");
          if (options.absenceFailure)
            throw Object.assign(Error("private"), {
              code: "cleanup_unverified",
            });
          return {
            status: "pass",
            attempted: true,
            confirmed: true,
            checkedAt: new Date(clock++).toISOString(),
            deletionMode: "recoverable",
          };
        },
      };
    },
  };
  function ports() {
    const p = createLocalPorts({
      root,
      token: "synthetic-token",
      request,
      fetch: vi.fn(),
      boundaries,
    });
    const read = p.manifest;
    return {
      ...p,
      manifest: () => {
        manifestReads++;
        if (manifestReads === 2) {
          events.push("manifest");
          if (options.drift) files[baseline] = Buffer.from("changed");
          if (options.finalManifestFailure) throw Error("private");
        }
        return read();
      },
    };
  }
  return {
    root,
    request,
    manifest,
    boundaries,
    ports,
    events,
    queries,
    clients,
    commands,
    files,
    getRegistry: () => registryRef,
  };
}
async function run(options) {
  const f = fixture(options);
  const result = await runEquivalence(f.request, f.ports());
  expect(parseEvidence(result.evidence)).toEqual(result.evidence);
  return { ...f, ...result };
}
const check = (e, id) => e.checks.find((c) => c.id === id);

describe("schema equivalence injected orchestration", () => {
  it("preserves reset/auth/migration/introspection order and proves both ledgers", async () => {
    const r = await run();
    expect(r.events).toEqual([
      "constructNeon",
      "parent",
      "create",
      "connection",
      "resetA",
      "shimA",
      "migrateA",
      "inspectA",
      "resetB",
      "shimB",
      "baseline",
      "migrateB",
      "inspectB",
      "dryRun",
      "compare",
      "delete",
      "absence",
      "manifest",
    ]);
    expect(
      r.queries.filter((q) => q.includes("create schema if not exists auth")),
    ).toEqual([authSql, authSql]);
    for (const index of r.queries
      .map((sql, i) => (sql.includes("drop schema") ? i : -1))
      .filter((i) => i >= 0)) {
      expect(r.queries[index - 1]).toContain("current_database()");
      expect(r.queries[index - 1]).toContain("current_user");
    }
    expect(r.evidence.paths).toEqual({
      A: { status: "pass", headManifestHash: r.manifest.hash },
      B: { status: "pass", headManifestHash: r.manifest.hash },
    });
    expect(r.exitCode).toBe(0);
    expect(r.evidence.status).toBe("pass");
    expect(r.getRegistry().cleanupCandidate()).toBeNull();
  });
  it.each([{ dryFailure: true }, { pending: true }])(
    "requires successful dry-run and no-pending content: %j",
    async (options) => {
      const r = await run(options);
      expect(r.exitCode).toBe(1);
      expect(check(r.evidence, "bootstrap").code).toBe("bootstrap_failed");
    },
  );
  it("does not compare after baseline-to-head migration failure", async () => {
    const r = await run({ migrateFailure: "B" });
    expect(r.evidence.comparison).toBeNull();
    expect(r.events).not.toContain("dryRun");
    expect(r.exitCode).toBe(1);
    expect(r.events).toContain("absence");
  });
  it.each(["A", "B"])(
    "checks actual database and role before reset %s",
    async (side) => {
      for (const field of ["database", "role", "project_id", "branch_id"]) {
        const bad =
          field === "branch_id"
            ? "br-wrong"
            : field === "project_id"
              ? "wrong-project"
              : "wrong";
        const r = await run({ session: { [side]: { [field]: bad } } });
        expect(r.events).not.toContain("reset" + side);
        expect(r.exitCode).toBe(1);
        expect(check(r.evidence, "session" + side).status).toBe("fail");
        expect(r.events).toContain("absence");
      }
    },
  );
  it.each([
    { deleteFailure: true },
    { absenceFailure: true },
    { revoked: true },
  ])("preserves cleanup failure and diagnostics: %j", async (options) => {
    const r = await run(options);
    expect(r.exitCode).toBe(1);
    expect(check(r.evidence, "cleanup").status).toBe("fail");
    expect(r.evidence.child.id).toBe("br-child");
    expect(r.getRegistry().cleanupCandidate()).not.toBeNull();
    if (options.revoked) expect(r.evidence.cleanup.attempted).toBe(false);
    if (options.deleteFailure)
      expect(r.evidence.comparison.status).toBe("pass");
  });
  it.each(["operation_failed", "identity_mismatch", "timeout"])(
    "records an attempted DELETE when deletion reports %s",
    async (code) => {
      const r = await run({ deleteOperationFailure: code });
      expect(r.evidence.cleanup.attempted).toBe(true);
      expect(r.exitCode).toBe(1);
      expect(r.getRegistry().cleanupCandidate()).not.toBeNull();
    },
  );
  it("does not infer DELETE dispatch from an error code", async () => {
    const r = await run({
      deleteOperationFailure: "operation_failed",
      deleteAttempted: false,
    });
    expect(r.evidence.cleanup.attempted).toBe(false);
    expect(r.exitCode).toBe(1);
  });
  it("retains null for malformed session values without leaking them or losing cleanup", async () => {
    const r = await run({
      session: {
        B: { role: "postgresql://secret:password@private.invalid/db" },
      },
    });
    expect(r.evidence.sessions.B.role).toBeNull();
    expect(r.events).not.toContain("resetB");
    expect(r.events).toContain("absence");
    expect(JSON.stringify(r.evidence)).not.toContain("password");
  });
  it("records ambiguous create without deletion or SQL", async () => {
    const r = await run({ ambiguous: true });
    expect(r.evidence.child).toBeNull();
    expect(r.events).not.toContain("delete");
    expect(r.clients).toHaveLength(0);
    expect(check(r.evidence, "child").code).toBe("possible_orphan");
    expect(check(r.evidence, "cleanup").code).toBe("cleanup_unverified");
  });
  it("cleans a proved child after URI acquisition fails", async () => {
    const r = await run({ uriFailure: true });
    expect(r.events).toContain("absence");
    expect(r.clients).toHaveLength(0);
    expect(r.exitCode).toBe(1);
  });
  it.each([
    { drift: true },
    { finalManifestFailure: true },
    { finalDirty: true },
    { finalHead: true },
  ])("requires final filesystem observation: %j", async (options) => {
    const r = await run(options);
    expect(r.evidence.manifest).toEqual(r.manifest);
    expect(check(r.evidence, "manifest").code).toBe("manifest_drift");
    expect(r.exitCode).toBe(1);
  });
  it("retains schema divergence counts", async () => {
    const r = await run({ diff: true });
    expect(r.evidence.comparison.classes.columns.extra).toBe(1);
    expect(r.exitCode).toBe(1);
  });
  it.each([
    "missing",
    "extra",
    "duplicate",
    "chain-checksum",
    "baseline-checksum",
  ])("rejects invalid ledger %s despite migration exit zero", async (mode) => {
    const r = await run({
      ledger: (rows, side) => {
        if (side !== "B") return rows;
        if (mode === "missing") return rows.slice(1);
        if (mode === "extra")
          return [...rows, { filename: "999_extra.sql", checksum: null }];
        if (mode === "duplicate") return [...rows, rows[0]];
        return rows.map((row, i) =>
          (mode === "chain-checksum" && i === 1) ||
          (mode === "baseline-checksum" && i === 0)
            ? { ...row, checksum: "c".repeat(64) }
            : row,
        );
      },
    });
    expect(check(r.evidence, "pathB").status).toBe("fail");
    expect(r.evidence.comparison).toBeNull();
    expect(r.exitCode).toBe(1);
  });
});
describe("local adapters with synthetic effects", () => {
  it("constructs clients lazily and closes failed connections without raw errors", async () => {
    const f = fixture({ connectFailure: true });
    const ports = f.ports();
    expect(f.clients).toHaveLength(0);
    const r = await runEquivalence(f.request, ports);
    expect(f.clients.every((c) => c.ended)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(
      /password|private.invalid|synthetic-token/,
    );
    expect(r.exitCode).toBe(1);
  });
  it("uses a bounded shell-free Node subprocess with isolated environment and captured output", async () => {
    const r = await run();
    const calls = r.commands.filter((c) => c.command !== "git");
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.command).toBe(process.execPath);
      expect(c.opts).toMatchObject({
        cwd: r.root,
        shell: false,
        timeout: 600000,
        maxBuffer: 1048576,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(c.opts.env.MIGRATE_DATABASE_URL).toContain("ep-child.neon.tech");
      expect(c.opts.env).not.toHaveProperty("DATABASE_URL");
      expect(c.opts.env).not.toHaveProperty("NODE_OPTIONS");
      expect(c.opts.env).not.toHaveProperty("NEON_API_KEY");
      expect(c.opts.env).not.toHaveProperty("UNRELATED_SECRET");
      expect(c.args[0]).toBe("scripts/migrate.ts");
    }
  });
  it.each(["invalid-request", "hash", "dirty", "head", "inventory"])(
    "rejects %s before constructing network ports or SQL clients",
    async (mode) => {
      const f = fixture({
        dirty: mode === "dirty",
        wrongHead: mode === "head",
      });
      if (mode === "invalid-request")
        f.request.database = "postgresql://private";
      if (mode === "hash") f.request.manifestHash = "d".repeat(64);
      if (mode === "inventory")
        delete f.files["scripts/schema-equivalence/runner.mjs"];
      expect(() => f.ports()).toThrow("invalid_input");
      expect(f.events).not.toContain("constructNeon");
      expect(f.clients).toHaveLength(0);
    },
  );
  it("exposes pure local clean-HEAD manifest preflight for CLI before credentials", () => {
    const f = fixture();
    expect(
      inspectLocalManifest({
        root: f.root,
        sourceSha,
        boundaries: f.boundaries,
      }),
    ).toEqual(f.manifest);
    expect(f.events).toEqual([]);
  });
  it("runner rejects malformed pinned manifests before observing neon ports", async () => {
    const f = fixture();
    const network = vi.fn();
    await expect(
      runEquivalence(f.request, {
        manifest: () => ({ ...f.manifest, hash: "f".repeat(64) }),
        get neon() {
          network();
        },
      }),
    ).rejects.toThrow("invalid_input");
    expect(network).not.toHaveBeenCalled();
  });
});
