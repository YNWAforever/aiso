import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  parseRequest,
  buildEvidence,
  parseEvidence,
  assessEvidence,
  renderEvidence,
  LIMITS,
  CHECKS,
  CLASSES,
} from "../../scripts/schema-equivalence/contract.mjs";
const sha = "a".repeat(40),
  hash = "b".repeat(64);
function sample() {
  const body = {
    version: 1,
    sourceSha: sha,
    baseline: { path: "synthetic/baseline.sql", sha256: hash },
    migrations: [{ path: "synthetic/001.sql", sha256: hash }],
    harness: [{ path: "synthetic/runner.mjs", sha256: hash }],
  };
  const manifest = {
    ...body,
    hash: createHash("sha256").update(canonicalJson(body)).digest("hex"),
  };
  const request = {
    version: 1,
    sourceSha: sha,
    manifestHash: manifest.hash,
    projectId: "synthetic-project",
    parentId: "br-synthetic-parent",
    database: "synthetic_db",
    role: "synthetic_owner",
    protectedBranchIds: ["br-synthetic-protected"],
    protectedHosts: ["protected.invalid"],
    sterilityReference: "synthetic-only",
  };
  return {
    version: 1,
    kind: "schema-equivalence",
    origin: "synthetic",
    enforced: false,
    productionReady: false,
    runId: "c".repeat(32),
    request,
    manifest,
    startedAt: "2026-09-08T00:00:00.000Z",
    completedAt: "2026-09-08T00:10:00.000Z",
    parent: { projectId: request.projectId, id: request.parentId },
    child: {
      projectId: request.projectId,
      id: "br-synthetic-child",
      parentId: request.parentId,
      name: "synthetic-child",
      expiresAt: "2026-09-08T02:00:00.000Z",
    },
    sessions: {
      A: {
        projectId: request.projectId,
        branchId: "br-synthetic-child",
        database: request.database,
        role: request.role,
      },
      B: {
        projectId: request.projectId,
        branchId: "br-synthetic-child",
        database: request.database,
        role: request.role,
      },
    },
    paths: {
      A: { status: "pass", headManifestHash: manifest.hash },
      B: { status: "pass", headManifestHash: manifest.hash },
    },
    comparison: {
      status: "pass",
      classes: Object.fromEntries(
        CLASSES.map((c) => [c, { missing: 0, extra: 0, changed: 0 }]),
      ),
    },
    bootstrap: { status: "pass", nothingPending: true },
    cleanup: {
      status: "pass",
      attempted: true,
      confirmed: true,
      checkedAt: "2026-09-08T00:09:00.000Z",
      deletionMode: "recoverable",
    },
  };
}
const context = (e) => ({
  request: e.request,
  manifest: e.manifest,
  now: Date.parse(e.completedAt),
});
describe("schema evidence contract", () => {
  it("derives complete successful synthetic evidence but never reusable provenance", () => {
    const e = buildEvidence(sample());
    expect(e.status).toBe("pass");
    expect(e.checks.map((x) => x.id)).toEqual(CHECKS);
    expect(parseEvidence(JSON.stringify(e))).toEqual(e);
    expect(assessEvidence(e, context(e))).toMatchObject({
      status: "pass",
      consistent: true,
      reusable: false,
      provenance: "unverified",
      productionReady: false,
    });
    expect(renderEvidence(e)).toContain("synthetic");
  });
  it("retains cleanup failure despite equivalent schemas", () => {
    const e = sample();
    e.cleanup = {
      status: "fail",
      attempted: true,
      confirmed: false,
      checkedAt: null,
      deletionMode: "recoverable",
    };
    expect(parseEvidence(buildEvidence(e)).status).toBe("fail");
  });
  it.each(CHECKS)("preserves explicit failure for %s", (id) => {
    const e = sample();
    e.checks = [{ id, status: "fail", code: "operation_failed" }];
    expect(
      parseEvidence(buildEvidence(e)).checks.find((c) => c.id === id).status,
    ).toBe("fail");
  });
  it.each(CHECKS)("rejects missing canonical check %s", (id) => {
    const e = buildEvidence(sample());
    e.checks = e.checks.filter((c) => c.id !== id);
    expect(() => parseEvidence(e)).toThrow("Invalid schema evidence");
  });
  it("completes unavailable observations as unknown", () => {
    const e = sample();
    delete e.parent;
    delete e.child;
    delete e.sessions;
    delete e.paths;
    delete e.comparison;
    delete e.bootstrap;
    delete e.cleanup;
    const v = buildEvidence(e);
    expect(v.parent).toBeNull();
    expect(v.status).toBe("unknown");
    expect(parseEvidence(v)).toEqual(v);
  });
  it.each([
    "sourceSha",
    "manifestHash",
    "projectId",
    "parentId",
    "database",
    "role",
    "sterilityReference",
  ])("rejects wrong type request %s", (key) => {
    for (const v of [null, [], {}, 42, true, ""]) {
      const r = sample().request;
      r[key] = v;
      expect(() => parseRequest(r)).toThrow("Invalid schema request");
    }
  });
  it("rejects strict request bounds and policy", () => {
    for (const mutate of [
      (r) => (r.extra = true),
      (r) => (r.protectedBranchIds = []),
      (r) => (r.protectedHosts = []),
      (r) => (r.protectedHosts = ["https://host.invalid"]),
      (r) => (r.protectedHosts = ["Host.invalid"]),
      (r) => (r.protectedHosts = ["host.invalid:443"]),
      (r) => (r.protectedBranchIds = [r.parentId]),
      (r) => (r.protectedHosts = Array(65).fill("host.invalid")),
      (r) => (r.protectedBranchIds = Array(65).fill("br-test")),
      (r) => (r.database = "a".repeat(64)),
      (r) => (r.sterilityReference = "x".repeat(129)),
    ]) {
      const r = sample().request;
      mutate(r);
      expect(() => parseRequest(r)).toThrow();
    }
  });
  it("rejects oversized JSON and duplicate object keys", () => {
    expect(() =>
      parseRequest(" ".repeat(LIMITS.requestBytes) + "{}"),
    ).toThrow();
    expect(() =>
      parseEvidence(" ".repeat(LIMITS.evidenceBytes) + "{}"),
    ).toThrow();
    expect(() =>
      parseRequest(
        JSON.stringify(sample().request).replace(
          '"version":1',
          '"version":1,"version":1',
        ),
      ),
    ).toThrow();
  });
  it.each(["parent", "child", "sessionA", "sessionB"])(
    "derives identity mismatch for %s",
    (id) => {
      const e = sample();
      if (id.startsWith("session")) e.sessions[id.slice(-1)].role = "wrong";
      else e[id].projectId = "wrong";
      const v = buildEvidence(e);
      expect(v.checks.find((c) => c.id === id).status).toBe("fail");
      expect(parseEvidence(v)).toEqual(v);
    },
  );
  it("protected child cannot pass", () => {
    const e = sample();
    e.child.id = e.request.protectedBranchIds[0];
    expect(buildEvidence(e).status).toBe("fail");
  });
  it.each(["missing", "extra", "changed"])(
    "derives nonzero difference failure and bounds %s",
    (k) => {
      const e = sample();
      e.comparison.classes.columns[k] = 1;
      expect(buildEvidence(e).status).toBe("fail");
      for (const n of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, null]) {
        e.comparison.classes.columns[k] = n;
        expect(() => buildEvidence(e)).toThrow();
      }
    },
  );
  it("rejects forged aggregates, codes, extra fields and relationship claims", () => {
    for (const mutate of [
      (e) => (e.status = "fail"),
      (e) => (e.trusted = true),
      (e) => e.checks.push(e.checks[0]),
      (e) => (e.checks[0].code = "absent"),
      (e) => (e.comparison.classes.columns.missing = 1),
      (e) => (e.bootstrap.nothingPending = false),
      (e) => (e.cleanup.confirmed = false),
      (e) => (e.paths.A.headManifestHash = hash),
    ]) {
      const e = buildEvidence(sample());
      mutate(e);
      expect(() => parseEvidence(e)).toThrow();
    }
  });
  it("rejects manifest tampering, unsafe paths and limits", () => {
    for (const mutate of [
      (e) => (e.manifest.hash = hash),
      (e) => (e.manifest.sourceSha = "d".repeat(40)),
      (e) => (e.request.manifestHash = hash),
      (e) => (e.manifest.baseline.path = "../bad"),
      (e) => (e.manifest.baseline.path = "/bad"),
      (e) => (e.manifest.baseline.path = "a\\b"),
      (e) => (e.manifest.baseline.path = "a".repeat(241)),
      (e) =>
        (e.manifest.migrations = Array(513).fill(e.manifest.migrations[0])),
      (e) => (e.manifest.harness = Array(65).fill(e.manifest.harness[0])),
    ]) {
      const e = sample();
      mutate(e);
      expect(() => buildEvidence(e)).toThrow();
    }
  });
  it("validates time ordering and cleanup relationships", () => {
    for (const mutate of [
      (e) => (e.completedAt = e.startedAt.replace("08T", "07T")),
      (e) => (e.cleanup.checkedAt = "2026-09-08T00:11:00.000Z"),
      (e) => (e.cleanup.checkedAt = "2026-09-07T00:00:00.000Z"),
      (e) => (e.child.expiresAt = e.startedAt),
      (e) => (e.child.expiresAt = "2026-09-08T02:00:00.001Z"),
    ]) {
      const e = sample();
      mutate(e);
      expect(() => buildEvidence(e)).toThrow();
    }
    const e = sample();
    e.cleanup.attempted = false;
    expect(buildEvidence(e).status).toBe("fail");
  });
  it("assesses exact freshness, future clock and context mismatches", () => {
    const e = buildEvidence(sample()),
      c = context(e);
    expect(
      assessEvidence(e, { ...c, now: c.now + LIMITS.freshnessMs }).consistent,
    ).toBe(true);
    for (const ctx of [
      { ...c, now: c.now + LIMITIS },
      { ...c, now: c.now - 1 },
      { ...c, request: { ...c.request, role: "other" } },
    ])
      expect(assessEvidence(e, ctx).consistent).toBe(false);
  });
  it("canonical hashing sorts object keys and preserves arrays", () => {
    expect(canonicalJson({ z: 1, a: [2, 1] })).toBe('{"a":[2,1],"z":1}');
    expect(() => canonicalJson({ a: undefined })).toThrow();
  });
});
const LIMITIS = 2592000001;

it("shared fixture is exactly the canonical builder output", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixture = JSON.parse(
    await readFile(
      new URL("../fixtures/schema-evidence.json", import.meta.url),
      "utf8",
    ),
  );
  expect(fixture).toEqual(buildEvidence(sample()));
  expect(parseEvidence(fixture)).toEqual(fixture);
});
it.each(["A", "B"])("path %s requires session and exact head", (side) => {
  const e = sample();
  e.paths[side].headManifestHash = "d".repeat(64);
  expect(
    buildEvidence(e).checks.find((c) => c.id === "path" + side),
  ).toMatchObject({ status: "fail", code: "manifest_drift" });
  e.paths[side].headManifestHash = e.manifest.hash;
  e.sessions[side] = null;
  expect(
    buildEvidence(e).checks.find((c) => c.id === "path" + side),
  ).toMatchObject({ status: "unknown", code: "dependency_failed" });
});
it("live label never authenticates evidence", () => {
  const e = sample();
  e.origin = "live";
  const v = buildEvidence(e);
  expect(assessEvidence(v, context(v))).toMatchObject({
    consistent: true,
    reusable: false,
    provenance: "unverified",
  });
});
it("partial observed identity stays null and unknown", () => {
  const e = sample();
  e.child.id = null;
  const v = buildEvidence(e);
  expect(v.child.id).toBeNull();
  expect(v.checks.find((c) => c.id === "child").status).toBe("unknown");
  expect(parseEvidence(v)).toEqual(v);
});
it.each([
  "version",
  "kind",
  "origin",
  "enforced",
  "productionReady",
  "runId",
  "request",
  "manifest",
  "startedAt",
  "completedAt",
  "parent",
  "child",
  "sessions",
  "paths",
  "comparison",
  "bootstrap",
  "cleanup",
  "checks",
  "status",
])("canonical evidence requires %s", (key) => {
  const e = buildEvidence(sample());
  delete e[key];
  expect(() => parseEvidence(e)).toThrow();
});
it.each([
  "parent",
  "child",
  "sessions",
  "paths",
  "comparison",
  "bootstrap",
  "cleanup",
])("observation %s rejects unknown fields", (key) => {
  const e = sample();
  e[key].secret = "secret-sentinel";
  try {
    buildEvidence(e);
    throw new Error("accepted");
  } catch (error) {
    expect(error.message).toBe("Invalid schema evidence");
    expect(error.message).not.toContain("secret-sentinel");
  }
});
it("all schema classes must be present and exact", () => {
  for (const key of CLASSES) {
    const e = sample();
    delete e.comparison.classes[key];
    expect(() => buildEvidence(e)).toThrow();
  }
  const e = sample();
  e.comparison.classes.other = { missing: 0, extra: 0, changed: 0 };
  expect(() => buildEvidence(e)).toThrow();
});
it("request rejects invalid identifiers, duplicate policy and host syntax", () => {
  for (const [key, values] of Object.entries({
    sourceSha: ["A".repeat(40), "a".repeat(39), "a".repeat(41)],
    manifestHash: ["B".repeat(64), "b".repeat(63), "b".repeat(65)],
    projectId: ["x".repeat(61), "UPPER", "a/b"],
    parentId: ["parent", "br-", "br-" + "x".repeat(58)],
    role: ["x".repeat(64), "1role", "with space"],
    protectedHosts: [
      ["host.invalid", "host.invalid"],
      ["host..invalid"],
      ["-host.invalid"],
      ["host-.invalid"],
      ["x".repeat(64) + ".invalid"],
    ],
    protectedBranchIds: [["br-x", "br-x"]],
    sterilityReference: ["x".repeat(129), "secret://credential"],
  })) {
    for (const value of values) {
      const r = sample().request;
      r[key] = value;
      expect(() => parseRequest(r)).toThrow();
    }
  }
});
it("manifest collection counts, duplicate paths and entry keys are validated independently of hash", () => {
  for (const mutate of [
    (m) => (m.migrations = []),
    (m) => (m.harness = []),
    (m) => m.migrations.push({ ...m.baseline }),
    (m) => (m.baseline.extra = true),
    (m) => (m.baseline.sha256 = "bad"),
    (m) => (m.baseline.path = "a//b"),
    (m) => (m.baseline.path = "a/./b"),
    (m) => (m.baseline.path = "a/../b"),
    (m) => (m.baseline.path = "C:/bad"),
    (m) => (m.baseline.path = "a\0b"),
    (m) =>
      (m.migrations = Array.from({ length: 513 }, (_, i) => ({
        path: `m/${i}`,
        sha256: hash,
      }))),
    (m) =>
      (m.harness = Array.from({ length: 65 }, (_, i) => ({
        path: `h/${i}`,
        sha256: hash,
      }))),
  ]) {
    const e = sample();
    mutate(e.manifest);
    const { hash: old, ...body } = e.manifest;
    expect(old).toBeTruthy();
    e.manifest.hash = createHash("sha256")
      .update(canonicalJson(body))
      .digest("hex");
    e.request.manifestHash = e.manifest.hash;
    expect(() => buildEvidence(e)).toThrow();
  }
});
it("cleanup cannot claim absence without child, readback and confirmation", () => {
  for (const mutate of [
    (e) => (e.child = null),
    (e) => (e.cleanup.checkedAt = null),
    (e) => (e.cleanup.confirmed = false),
    (e) => (e.cleanup.attempted = false),
    (e) => (e.cleanup.status = "unknown"),
  ]) {
    const e = sample();
    mutate(e);
    const v = buildEvidence(e);
    expect(v.status).not.toBe("pass");
    expect(parseEvidence(v)).toEqual(v);
  }
});
it("rejects duplicate escaped keys and nested duplicate keys", () => {
  const e = buildEvidence(sample());
  for (const raw of [
    JSON.stringify(e).replace('"version":1', '"version":1,"\\u0076ersion":1'),
    JSON.stringify(e).replace(
      '"attempted":true',
      '"attempted":true,"attempted":true',
    ),
  ])
    expect(() => parseEvidence(raw)).toThrow();
});
it("canonical primitives exclude cycles, nonfinite, sparse and custom objects", () => {
  const cycle = {};
  cycle.self = cycle;
  for (const v of [cycle, NaN, Infinity, new Date(), { x: 1n }, Array(2)])
    expect(() => canonicalJson(v)).toThrow();
});
