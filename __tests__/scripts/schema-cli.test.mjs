import { describe, expect, it, vi } from "vitest";
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  parseEvidence,
  assessEvidence,
  buildEvidence,
  LIMITS,
} from "../../scripts/schema-equivalence/contract.mjs";
import { buildManifest } from "../../scripts/schema-equivalence/manifest.mjs";
import { runEquivalence } from "../../scripts/schema-equivalence/runner.mjs";
const effects = vi.hoisted(() => ({
  legacy: vi.fn(() => {
    throw Error("synthetic stop");
  }),
  exec: vi.fn(),
  client: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("../helpers/neon-branch.ts", () => ({
  createTestBranch: effects.legacy,
  createdBranchIds: () => [],
  deleteTestBranch: effects.legacy,
  assertDisposableTestBranch: effects.legacy,
  PROJECT_ID: "synthetic",
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original()),
  execFileSync: effects.exec,
}));
vi.mock("@neondatabase/serverless", () => ({
  Client: effects.client,
  neonConfig: {},
}));
const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/schema-evidence.json", import.meta.url),
    "utf8",
  ),
);
const args = ["--request", "request.json", "--output-dir", "evidence"];
function setup() {
  const events = [],
    writes = new Map(),
    logs = [];
  const ports = {
    root: path.resolve("synthetic"),
    readRequest: vi.fn(async () => JSON.stringify(fixture.request)),
    inspectLocalManifest: vi.fn(() => {
      events.push("inspect");
      return fixture.manifest;
    }),
    createLocalPorts: vi.fn(() => {
      events.push("create");
      return { origin: "synthetic" };
    }),
    runEquivalence: vi.fn(async () => {
      events.push("finished-cleanup-manifest");
      return { evidence: fixture, exitCode: 0 };
    }),
    mkdir: vi.fn(async () => {
      events.push("mkdir");
    }),
    writeFile: vi.fn(async (file, content, options) => {
      expect(options.flag).toBe("wx");
      events.push("write");
      if (writes.has(file))
        throw Error("postgresql://secret:password@private.invalid/db");
      writes.set(file, content);
    }),
    log: (value) => logs.push(value),
    error: (value) => logs.push(value),
  };
  const env = {
    get NEON_API_KEY() {
      events.push("token");
      return "synthetic-token";
    },
  };
  return { ports, env, events, writes, logs };
}
vi.stubGlobal("fetch", effects.fetch);
const entry = await import("../../scripts/schema-equivalence.mjs");
describe("guarded schema CLI", () => {
  it("imports without subprocess, fetch, Client or legacy lifecycle effects", () => {
    expect(effects.legacy).not.toHaveBeenCalled();
    expect(effects.exec).not.toHaveBeenCalled();
    expect(effects.client).not.toHaveBeenCalled();
    expect(effects.fetch).not.toHaveBeenCalled();
    expect(entry.main).toBeTypeOf("function");
  });
  it.each([
    [],
    ["--request", "x"],
    [...args, "--live"],
    [...args, "--trusted"],
    [...args, "--token", "private"],
    [...args, "--uri", "private"],
    [...args, "--request", "y"],
    ["--request", "--output-dir", "x"],
    [...args, "extra"],
    ["--request=x", "--output-dir=y"],
  ])("rejects malformed args before effects %j", async (...input) => {
    const h = setup();
    expect(await entry.main(input, h.env, h.ports)).toBe(1);
    expect(h.ports.readRequest).not.toHaveBeenCalled();
    expect(h.events).toEqual([]);
  });
  it.each([
    "{",
    "x".repeat(LIMITS.requestBytes + 1),
    JSON.stringify({ ...fixture.request, live: true }),
  ])(
    "rejects invalid or oversized request before credentials",
    async (content) => {
      const h = setup();
      h.ports.readRequest.mockResolvedValue(content);
      expect(await entry.main(args, h.env, h.ports)).toBe(1);
      expect(h.events).toEqual([]);
      expect(h.ports.readRequest).toHaveBeenCalledExactlyOnceWith(
        "request.json",
        LIMITS.requestBytes,
      );
    },
  );
  it("rejects local hash mismatch before token lookup or port construction", async () => {
    const h = setup();
    h.ports.inspectLocalManifest.mockReturnValue({
      ...fixture.manifest,
      hash: "0".repeat(64),
    });
    expect(await entry.main(args, h.env, h.ports)).toBe(1);
    expect(h.events).toEqual([]);
    expect(h.ports.createLocalPorts).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "bad token", "x".repeat(4097), "bad\u0000token"])(
    "rejects missing or invalid token",
    async (token) => {
      const h = setup();
      expect(await entry.main(args, { NEON_API_KEY: token }, h.ports)).toBe(1);
      expect(h.ports.createLocalPorts).not.toHaveBeenCalled();
      expect(h.logs).toEqual(["Schema rehearsal failed"]);
    },
  );
  it("writes canonical artifacts only after runner cleanup and final manifest", async () => {
    const h = setup();
    expect(await entry.main(args, h.env, h.ports)).toBe(0);
    expect(h.events).toEqual([
      "inspect",
      "token",
      "create",
      "finished-cleanup-manifest",
      "mkdir",
      "write",
      "write",
    ]);
    const json = [...h.writes.values()][0];
    const evidence = parseEvidence(json);
    expect(evidence).toEqual(fixture);
    expect(evidence.productionReady).toBe(false);
    expect(
      assessEvidence(evidence, {
        request: fixture.request,
        manifest: fixture.manifest,
        now: Date.parse(fixture.completedAt),
      }).reusable,
    ).toBe(false);
    expect(h.ports.runEquivalence).toHaveBeenCalledExactlyOnceWith(
      fixture.request,
      { origin: "synthetic" },
    );
  });
  it("does not overwrite an existing artifact or echo provider errors", async () => {
    const h = setup();
    const file = path.resolve("evidence", `schema-${fixture.runId}.json`);
    h.writes.set(file, "existing");
    expect(await entry.main(args, h.env, h.ports)).toBe(1);
    expect(h.writes.get(file)).toBe("existing");
    expect(h.ports.writeFile).toHaveBeenCalledTimes(1);
    expect(h.logs.join(" ")).not.toMatch(/secret|password|private/);
  });
  it("keeps JSON cleanup evidence when the second exclusive write fails", async () => {
    const h = setup();
    h.ports.writeFile
      .mockImplementationOnce(async (file, content) =>
        h.writes.set(file, content),
      )
      .mockRejectedValueOnce(Error("private-token"));
    expect(await entry.main(args, h.env, h.ports)).toBe(1);
    expect(parseEvidence([...h.writes.values()][0]).cleanup).toEqual(
      fixture.cleanup,
    );
    expect(h.logs.join(" ")).not.toContain("private-token");
  });
  it("preserves canonical failed evidence and forces exit 1", async () => {
    const h = setup();
    const evidence = buildEvidence({
      ...fixture,
      cleanup: { ...fixture.cleanup, status: "fail", confirmed: false },
      checks: [{ id: "cleanup", status: "fail", code: "cleanup_failed" }],
    });
    h.ports.runEquivalence.mockResolvedValue({ evidence, exitCode: 0 });
    expect(await entry.main(args, h.env, h.ports)).toBe(1);
    expect(parseEvidence([...h.writes.values()][0]).cleanup.confirmed).toBe(
      false,
    );
  });
  it.each([false, true])(
    "round-trips actual runner with synthetic success/failure %s",
    async (fail) => {
      const h = setup();
      let reads = 0,
        side = "A",
        handle;
      const modules = [
        "contract",
        "manifest",
        "target",
        "neon-port",
        "runner",
        "local-ports",
      ];
      const manifest = buildManifest({
        root: h.ports.root,
        sourceSha: fixture.request.sourceSha,
        realpath: (p) => p,
        readFile: (p) => Buffer.from(p),
        listFiles: (p) =>
          p.endsWith("migrations")
            ? ["001_fixture.sql"]
            : modules.map((n) => n + ".mjs"),
      });
      const request = { ...fixture.request, manifestHash: manifest.hash };
      h.ports.readRequest.mockResolvedValue(JSON.stringify(request));
      h.ports.inspectLocalManifest.mockReturnValue(manifest);
      h.ports.runEquivalence = runEquivalence;
      const runtime = {
        origin: "synthetic",
        now: () => Date.parse(fixture.completedAt),
        runId: () => fixture.runId,
        manifest: () => {
          reads++;
          return manifest;
        },
        registry: {
          cleanupCandidate: () => handle,
          assertSession: vi.fn(),
          forget: () => {
            handle = undefined;
          },
        },
        neon: {
          readProject: () => {
            if (fail) throw Error("postgresql://private:secret@host/db");
          },
          readParent: () => fixture.parent,
          createChild: () => {
            handle = {
              child: {
                ...fixture.child,
                expiresAt: new Date(
                  Date.parse(fixture.completedAt) + 60000,
                ).toISOString(),
              },
            };
            return handle;
          },
          connectionUri: vi.fn(),
          deleteChild: () => ({ attempted: true }),
          confirmAbsent: () => ({
            ...fixture.cleanup,
            checkedAt: fixture.completedAt,
          }),
        },
        reset: (_handle, value, observe) => {
          side = value;
          observe(fixture.sessions[value]);
        },
        applyMigrations: vi.fn(),
        applyBaseline: vi.fn(),
        ledger: () => [
          ...(side === "B"
            ? [
                {
                  filename: path.posix.basename(manifest.baseline.path),
                  checksum: manifest.baseline.sha256,
                },
              ]
            : []),
          { filename: "001_fixture.sql", checksum: null },
        ],
        introspect: () => ({}),
        dryRun: () => ({ ok: true, output: "Nothing to apply" }),
        diff: () => ({
          equivalent: true,
          classes: Object.fromEntries(
            Object.keys(fixture.comparison.classes).map((n) => [
              n,
              { onlyInLegacy: [], onlyInBaseline: [], changed: [] },
            ]),
          ),
        }),
      };
      h.ports.createLocalPorts.mockReturnValue(runtime);
      expect(await entry.main(args, h.env, h.ports)).toBe(fail ? 1 : 0);
      expect(reads).toBe(2);
      const evidence = parseEvidence([...h.writes.values()][0]);
      expect(evidence.origin).toBe("synthetic");
      expect(evidence.status).toBe(fail ? "fail" : "pass");
      expect([...h.writes.values()].join(" ")).not.toMatch(/private:secret/);
    },
  );
  it.each([
    Buffer.alloc(LIMITS.requestBytes + 1, 120),
    Buffer.from([255]),
    Buffer.from("{}"),
  ])(
    "bounds and validates real request-file reads without credentials",
    async (content) => {
      const directory = mkdtempSync(path.join(tmpdir(), "schema-cli-"));
      const file = path.join(directory, "request.json");
      try {
        writeFileSync(file, content);
        const h = setup();
        delete h.ports.readRequest;
        expect(
          await entry.main(
            ["--request", file, "--output-dir", directory],
            h.env,
            h.ports,
          ),
        ).toBe(1);
        expect(h.events).toEqual([]);
      } finally {
        unlinkSync(file);
        rmdirSync(directory);
      }
    },
  );
  it("reads a valid real request exactly before read-only preflight", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "schema-cli-"));
    const file = path.join(directory, "request.json");
    try {
      writeFileSync(file, JSON.stringify(fixture.request));
      const h = setup();
      delete h.ports.readRequest;
      h.ports.inspectLocalManifest.mockImplementation(() => {
        throw Error("private");
      });
      expect(
        await entry.main(
          ["--request", file, "--output-dir", directory],
          h.env,
          h.ports,
        ),
      ).toBe(1);
      expect(h.ports.inspectLocalManifest).toHaveBeenCalledExactlyOnceWith({
        root: h.ports.root,
        sourceSha: fixture.request.sourceSha,
      });
      expect(h.events).toEqual([]);
      expect(h.logs).toEqual(["Schema rehearsal failed"]);
    } finally {
      unlinkSync(file);
      rmdirSync(directory);
    }
  });
  it("actual Node missing-argument entry fails safely with synthetic environment", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/schema-equivalence.mjs"],
      {
        cwd: process.cwd(),
        env: {
          SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
          NODE_ENV: "test",
          NEXT_TELEMETRY_DISABLED: "1",
        },
        encoding: "utf8",
        timeout: 20000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Schema rehearsal failed\n");
  });
});
