import { createHash } from "node:crypto";

/**
 * @typedef {'pass'|'fail'|'unknown'} Status
 * @typedef {{version:1, sourceSha:string, manifestHash:string, projectId:string,
 * parentId:string, database:string, role:string, protectedBranchIds:string[],
 * protectedHosts:string[], sterilityReference:string}} Request
 * @typedef {{path:string, sha256:string}} ManifestEntry
 * @typedef {{version:1, sourceSha:string, baseline:ManifestEntry,
 * migrations:ManifestEntry[], harness:ManifestEntry[], hash:string}} Manifest
 * @typedef {{projectId:string|null, id:string|null}} Parent
 * @typedef {{projectId:string|null, id:string|null, parentId:string|null,
 * name:string|null, expiresAt:string|null}} Child
 * @typedef {{projectId:string|null, branchId:string|null, database:string|null,
 * role:string|null}} Session
 * @typedef {{status:Status, headManifestHash:string|null}} Path
 * @typedef {{missing:number, extra:number, changed:number}} Counts
 * @typedef {'columns'|'constraints'|'indexes'|'triggers'|'functions'|'grants'|'rls'|'extensions'} SchemaClass
 * @typedef {{status:Status, classes:Record<SchemaClass, Counts>|null}} Comparison
 * @typedef {{status:Status, nothingPending:boolean|null}} Bootstrap
 * @typedef {{status:Status, attempted:boolean, confirmed:boolean,
 * checkedAt:string|null, deletionMode:'recoverable'}} Cleanup
 * @typedef {'parent'|'child'|'sessionA'|'pathA'|'sessionB'|'pathB'|'comparison'|'bootstrap'|'manifest'|'cleanup'} CheckId
 * @typedef {'matched'|'completed'|'equivalent'|'nothing_pending'|'unchanged'|'absent'|
 * 'invalid_input'|'identity_mismatch'|'identity_unavailable'|'protected_target'|
 * 'possible_orphan'|'operation_failed'|'timeout'|'schema_diff'|'bootstrap_failed'|
 * 'manifest_drift'|'cleanup_failed'|'cleanup_unverified'|'dependency_failed'|'artifact_failed'} Code
 * @typedef {{id:CheckId, status:Status, code:Code}} Check
 * @typedef {{version:1, kind:'schema-equivalence', origin:'synthetic'|'live',
 * enforced:false, productionReady:false, runId:string, request:Request,
 * manifest:Manifest, startedAt:string, completedAt:string}} Envelope
 * @typedef {{parent:Parent|null, child:Child|null, sessions:{A:Session|null,B:Session|null},
 * paths:{A:Path|null,B:Path|null}, comparison:Comparison|null,
 * bootstrap:Bootstrap|null, cleanup:Cleanup|null}} Observations
 * @typedef {Envelope & Partial<Observations> & {checks?:Check[],status?:Status}} BuilderInput
 * @typedef {Envelope & Observations & {checks:Check[],status:Status}} Evidence
 * @typedef {{status:Status, consistent:boolean, reusable:false,
 * provenance:'unverified', productionReady:false, codes:Code[]}} Assessment
 */
export const LIMITS = Object.freeze({
  requestBytes: 65536,
  evidenceBytes: 1048576,
  apiBytes: 1048576,
  migrations: 512,
  harnessFiles: 64,
  protectedBranches: 64,
  protectedHosts: 64,
  relativePath: 240,
  reference: 128,
  sqlName: 63,
  ttlMs: 7200000,
  freshnessMs: 2592000000,
  httpMs: 20000,
  operationMs: 120000,
  operationPollMs: 1000,
  operationPolls: 120,
  subprocessMs: 600000,
  subprocessBytes: 1048576,
});
export const CLASSES = Object.freeze([
  "columns",
  "constraints",
  "indexes",
  "triggers",
  "functions",
  "grants",
  "rls",
  "extensions",
]);
export const CHECKS = Object.freeze([
  "parent",
  "child",
  "sessionA",
  "pathA",
  "sessionB",
  "pathB",
  "comparison",
  "bootstrap",
  "manifest",
  "cleanup",
]);
export const CODES = Object.freeze([
  "matched",
  "completed",
  "equivalent",
  "nothing_pending",
  "unchanged",
  "absent",
  "invalid_input",
  "identity_mismatch",
  "identity_unavailable",
  "protected_target",
  "possible_orphan",
  "operation_failed",
  "timeout",
  "schema_diff",
  "bootstrap_failed",
  "manifest_drift",
  "cleanup_failed",
  "cleanup_unverified",
  "dependency_failed",
  "artifact_failed",
]);
const statuses = ["pass", "fail", "unknown"],
  successCodes = [
    "matched",
    "completed",
    "equivalent",
    "nothing_pending",
    "unchanged",
    "absent",
  ];
const fail = () => {
  throw new Error("Invalid schema evidence");
};
const assert = (x) => {
  if (!x) fail();
};
const object = (v) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
function keys(v, required, optional = []) {
  assert(object(v));
  assert(required.every((k) => Object.hasOwn(v, k)));
  assert(
    Object.keys(v).every((k) => required.includes(k) || optional.includes(k)),
  );
}
function string(v, re, max) {
  assert(
    typeof v === "string" && v.length > 0 && v.length <= max && re.test(v),
  );
}
const project = (v) => string(v, /^[a-z0-9][a-z0-9-]*$/, 60);
const branch = (v) => string(v, /^br-[a-z0-9][a-z0-9-]*$/, 60);
const sql = (v) => string(v, /^[a-z_][a-z0-9_]*$/, 63);
const reference = (v) => string(v, /^[A-Za-z0-9_-]+$/, 128);
const sha = (v) => string(v, /^[a-f0-9]{40}$/, 40);
const hash = (v) => string(v, /^[a-f0-9]{64}$/, 64);
const status = (v) => assert(statuses.includes(v));
const boolean = (v) => assert(typeof v === "boolean");
function time(v) {
  string(v, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, 24);
  assert(Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
  return Date.parse(v);
}
function host(v) {
  string(v, /^[a-z0-9.-]+$/, 253);
  assert(
    v.includes(".") &&
      v
        .split(".")
        .every(
          (p) => p.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(p),
        ),
  );
}
function list(v, max, validate, min = 0) {
  assert(Array.isArray(v) && v.length >= min && v.length <= max);
  v.forEach(validate);
  assert(new Set(v.map((x) => canonicalJson(x))).size === v.length);
}
/** Stable JSON: exact JSON primitives/plain records only; preserves array order. */
export function canonicalJson(value) {
  const seen = new Set();
  function visit(v, depth) {
    assert(depth <= 32);
    if (v === null || typeof v === "string" || typeof v === "boolean")
      return JSON.stringify(v);
    if (typeof v === "number") {
      assert(Number.isFinite(v));
      return JSON.stringify(v);
    }
    assert(Array.isArray(v) || object(v));
    assert(!seen.has(v));
    seen.add(v);
    let result;
    if (Array.isArray(v)) {
      assert(Object.keys(v).length === v.length);
      result = "[" + v.map((x) => visit(x, depth + 1)).join(",") + "]";
    } else {
      assert(Reflect.ownKeys(v).length === Object.keys(v).length);
      result =
        "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + visit(v[k], depth + 1))
          .join(",") +
        "}";
    }
    seen.delete(v);
    assert(Buffer.byteLength(result) <= LIMITS.evidenceBytes);
    return result;
  }
  return visit(value, 0);
}
// JSON.parse discards duplicate keys. Inspect token structure first, including escaped keys.
function decode(value, limit) {
  if (typeof value !== "string") {
    const encoded = canonicalJson(value);
    assert(Buffer.byteLength(encoded) <= limit);
    return JSON.parse(encoded);
  }
  assert(Buffer.byteLength(value) <= limit);
  let i = 0;
  const ws = () => {
    while (/\s/.test(value[i] ?? "") && i < value.length) i++;
  };
  function quoted() {
    const start = i++;
    while (i < value.length) {
      if (value[i] === "\\") {
        i += 2;
        continue;
      }
      if (value[i++] === '"') return JSON.parse(value.slice(start, i));
    }
    fail();
  }
  function scan(depth) {
    assert(depth <= 32);
    ws();
    if (value[i] === "{") {
      i++;
      ws();
      const seen = new Set();
      if (value[i] === "}") {
        i++;
        return;
      }
      while (true) {
        ws();
        assert(value[i] === '"');
        const k = quoted();
        assert(!seen.has(k));
        seen.add(k);
        ws();
        assert(value[i++] === ":");
        scan(depth + 1);
        ws();
        if (value[i] === "}") {
          i++;
          return;
        }
        assert(value[i++] === ",");
      }
    }
    if (value[i] === "[") {
      i++;
      ws();
      if (value[i] === "]") {
        i++;
        return;
      }
      while (true) {
        scan(depth + 1);
        ws();
        if (value[i] === "]") {
          i++;
          return;
        }
        assert(value[i++] === ",");
      }
    }
    if (value[i] === '"') {
      quoted();
      return;
    }
    const m = value
      .slice(i)
      .match(
        /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/,
      );
    assert(m);
    i += m[0].length;
  }
  scan(0);
  ws();
  assert(i === value.length);
  return JSON.parse(value);
}
/** Request fields are exact, credentials and output paths are never request fields. */
export function parseRequest(value) {
  try {
    const r = decode(value, LIMITS.requestBytes);
    keys(r, [
      "version",
      "sourceSha",
      "manifestHash",
      "projectId",
      "parentId",
      "database",
      "role",
      "protectedBranchIds",
      "protectedHosts",
      "sterilityReference",
    ]);
    assert(r.version === 1);
    sha(r.sourceSha);
    hash(r.manifestHash);
    project(r.projectId);
    branch(r.parentId);
    sql(r.database);
    sql(r.role);
    reference(r.sterilityReference);
    list(r.protectedBranchIds, LIMITS.protectedBranches, branch, 1);
    list(r.protectedHosts, LIMITS.protectedHosts, host, 1);
    assert(!r.protectedBranchIds.includes(r.parentId));
    return r;
  } catch {
    throw new Error("Invalid schema request");
  }
}
function manifest(value) {
  keys(value, [
    "version",
    "sourceSha",
    "baseline",
    "migrations",
    "harness",
    "hash",
  ]);
  assert(value.version === 1);
  sha(value.sourceSha);
  hash(value.hash);
  const paths = new Set();
  function entry(v) {
    keys(v, ["path", "sha256"]);
    string(v.path, /^[A-Za-z0-9_./-]+$/, LIMITS.relativePath);
    assert(
      !v.path.startsWith("/") &&
        v.path.split("/").every((p) => p !== "" && p !== "." && p !== ".."),
    );
    assert(!paths.has(v.path));
    paths.add(v.path);
    hash(v.sha256);
  }
  entry(value.baseline);
  list(value.migrations, LIMITS.migrations, entry, 1);
  list(value.harness, LIMITS.harnessFiles, entry, 1);
  const { hash: expected, ...body } = value;
  assert(
    createHash("sha256").update(canonicalJson(body)).digest("hex") === expected,
  );
  return value;
}
const envelope = [
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
];
const observations = [
  "parent",
  "child",
  "sessions",
  "paths",
  "comparison",
  "bootstrap",
  "cleanup",
];
function identity(v, shape) {
  if (v === null) return;
  keys(v, Object.keys(shape));
  for (const [k, validate] of Object.entries(shape))
    if (v[k] !== null) validate(v[k]);
}
const complete = (v) => v !== null && Object.values(v).every((x) => x !== null);
/**
 * Build from the required envelope plus optional observations/checks/status.
 * Omitted observations become null (sessions/paths become {A:null,B:null}).
 * Identity records may contain null fields; these remain unobserved, never inferred.
 * Optional checks contain only {id,status,code}; explicit fail/unknown is retained.
 * Supplied pass checks and aggregate status cannot override derived relationships.
 */
export function buildEvidence(value) {
  try {
    const e = decode(value, LIMITS.evidenceBytes);
    keys(e, envelope, [...observations, "checks", "status"]);
    assert(
      e.version === 1 &&
        e.kind === "schema-equivalence" &&
        ["synthetic", "live"].includes(e.origin) &&
        e.enforced === false &&
        e.productionReady === false,
    );
    string(e.runId, /^[a-f0-9]{32}$/, 32);
    e.request = parseRequest(e.request);
    e.manifest = manifest(e.manifest);
    assert(
      e.request.sourceSha === e.manifest.sourceSha &&
        e.request.manifestHash === e.manifest.hash,
    );
    const start = time(e.startedAt),
      end = time(e.completedAt);
    assert(start <= end);
    for (const k of observations)
      e[k] ??= k === "sessions" || k === "paths" ? { A: null, B: null } : null;
    identity(e.parent, { projectId: project, id: branch });
    identity(e.child, {
      projectId: project,
      id: branch,
      parentId: branch,
      name: reference,
      expiresAt: time,
    });
    if (e.child?.expiresAt !== null && e.child !== null) {
      const expiry = time(e.child.expiresAt);
      assert(expiry > start && expiry <= start + LIMITS.ttlMs);
    }
    keys(e.sessions, ["A", "B"]);
    keys(e.paths, ["A", "B"]);
    for (const side of ["A", "B"]) {
      identity(e.sessions[side], {
        projectId: project,
        branchId: branch,
        database: sql,
        role: sql,
      });
      const p = e.paths[side];
      if (p !== null) {
        keys(p, ["status", "headManifestHash"]);
        status(p.status);
        if (p.headManifestHash !== null) hash(p.headManifestHash);
      }
    }
    if (e.comparison !== null) {
      keys(e.comparison, ["status", "classes"]);
      status(e.comparison.status);
      if (e.comparison.classes !== null) {
        keys(e.comparison.classes, CLASSES);
        for (const c of Object.values(e.comparison.classes)) {
          keys(c, ["missing", "extra", "changed"]);
          Object.values(c).forEach((n) =>
            assert(Number.isSafeInteger(n) && n >= 0),
          );
        }
      }
    }
    if (e.bootstrap !== null) {
      keys(e.bootstrap, ["status", "nothingPending"]);
      status(e.bootstrap.status);
      if (e.bootstrap.nothingPending !== null)
        boolean(e.bootstrap.nothingPending);
    }
    if (e.cleanup !== null) {
      keys(e.cleanup, [
        "status",
        "attempted",
        "confirmed",
        "checkedAt",
        "deletionMode",
      ]);
      status(e.cleanup.status);
      boolean(e.cleanup.attempted);
      boolean(e.cleanup.confirmed);
      assert(e.cleanup.deletionMode === "recoverable");
      if (e.cleanup.checkedAt !== null) {
        const checked = time(e.cleanup.checkedAt);
        assert(checked >= start && checked <= end);
      }
    }
    const supplied = new Map();
    if (e.checks !== undefined) {
      list(e.checks, CHECKS.length, (c) => {
        keys(c, ["id", "status", "code"]);
        assert(
          CHECKS.includes(c.id) &&
            CODES.includes(c.code) &&
            !supplied.has(c.id),
        );
        status(c.status);
        assert(
          c.status === "pass"
            ? successCodes.includes(c.code)
            : !successCodes.includes(c.code),
        );
        supplied.set(c.id, c);
      });
    }
    if (e.status !== undefined) status(e.status);
    const checks = [];
    const get = (id) => checks.find((c) => c.id === id)?.status;
    const add = (id, result, code, deps = []) => {
      let c = { id, status: result, code };
      const explicit = supplied.get(id);
      if (explicit?.status === "fail") c = explicit;
      else if (result !== "fail" && explicit?.status === "unknown")
        c = explicit;
      else if (result === "pass" && deps.some((d) => get(d) !== "pass"))
        c = { id, status: "unknown", code: "dependency_failed" };
      checks.push(c);
    };
    const r = e.request,
      child = e.child;
    const observed = (id, v, matches, deps = []) =>
      add(
        id,
        !complete(v) ? "unknown" : matches ? "pass" : "fail",
        !complete(v)
          ? "identity_unavailable"
          : matches
            ? "matched"
            : "identity_mismatch",
        deps,
      );
    observed(
      "parent",
      e.parent,
      e.parent?.projectId === r.projectId && e.parent?.id === r.parentId,
    );
    const protectedChild =
      child !== null &&
      (child.id === r.parentId || r.protectedBranchIds.includes(child.id));
    if (protectedChild) add("child", "fail", "protected_target");
    else
      observed(
        "child",
        child,
        child?.projectId === r.projectId && child?.parentId === r.parentId,
        ["parent"],
      );
    for (const side of ["A", "B"]) {
      const s = e.sessions[side];
      observed(
        "session" + side,
        s,
        s?.projectId === r.projectId &&
          s?.branchId === child?.id &&
          s?.database === r.database &&
          s?.role === r.role,
        ["child"],
      );
      const p = e.paths[side];
      add(
        "path" + side,
        p === null
          ? "unknown"
          : p.status === "fail"
            ? "fail"
            : p.headManifestHash !== null &&
                p.headManifestHash !== e.manifest.hash
              ? "fail"
              : p.status === "pass" && p.headManifestHash !== null
                ? "pass"
                : "unknown",
        p === null
          ? "dependency_failed"
          : p.status === "fail"
            ? "operation_failed"
            : p.headManifestHash !== null &&
                p.headManifestHash !== e.manifest.hash
              ? "manifest_drift"
              : p.status === "pass" && p.headManifestHash !== null
                ? "completed"
                : "dependency_failed",
        ["session" + side],
      );
    }
    const c = e.comparison,
      nonzero =
        c?.classes &&
        Object.values(c.classes).some((v) =>
          Object.values(v).some((n) => n !== 0),
        );
    add(
      "comparison",
      c?.status === "fail" || nonzero
        ? "fail"
        : c?.status === "pass" && c.classes !== null
          ? "pass"
          : "unknown",
      c?.status === "fail" || nonzero
        ? "schema_diff"
        : c?.status === "pass" && c.classes !== null
          ? "equivalent"
          : "dependency_failed",
      ["pathA", "pathB"],
    );
    const b = e.bootstrap;
    add(
      "bootstrap",
      b?.status === "fail" || b?.nothingPending === false
        ? "fail"
        : b?.status === "pass" && b.nothingPending === true
          ? "pass"
          : "unknown",
      b?.status === "fail" || b?.nothingPending === false
        ? "bootstrap_failed"
        : b?.status === "pass" && b.nothingPending === true
          ? "nothing_pending"
          : "dependency_failed",
      ["pathA", "pathB"],
    );
    add("manifest", "pass", "unchanged");
    const cl = e.cleanup,
      clean =
        cl?.status === "pass" &&
        cl.attempted &&
        cl.confirmed &&
        cl.checkedAt !== null;
    add(
      "cleanup",
      cl === null
        ? "unknown"
        : cl.status === "fail"
          ? "fail"
          : clean
            ? "pass"
            : cl.status === "pass"
              ? "fail"
              : "unknown",
      cl === null
        ? "dependency_failed"
        : cl.status === "fail"
          ? "cleanup_failed"
          : clean
            ? "absent"
            : "cleanup_unverified",
      ["child"],
    );
    e.checks = checks;
    e.status = checks.some((c) => c.status === "fail")
      ? "fail"
      : checks.every((c) => c.status === "pass")
        ? "pass"
        : "unknown";
    return JSON.parse(canonicalJson(e));
  } catch {
    fail();
  }
}
/** Parse canonical complete records; reject forged aggregates or relationship checks. */
export function parseEvidence(value) {
  try {
    const raw = decode(value, LIMITS.evidenceBytes);
    keys(raw, [...envelope, ...observations, "checks", "status"]);
    keys(raw.sessions, ["A", "B"]);
    keys(raw.paths, ["A", "B"]);
    assert(Array.isArray(raw.checks) && raw.checks.length === CHECKS.length);
    const built = buildEvidence(raw);
    assert(canonicalJson(raw) === canonicalJson(built));
    return built;
  } catch {
    fail();
  }
}
/** Local structural/context/freshness assessment never establishes artifact provenance. */
export function assessEvidence(
  evidence,
  { request, manifest: expectedManifest, now } = {},
) {
  try {
    const e = parseEvidence(evidence),
      r = parseRequest(request),
      m = manifest(decode(expectedManifest, LIMITS.evidenceBytes));
    assert(Number.isSafeInteger(now));
    const same =
      canonicalJson(e.request) === canonicalJson(r) &&
      canonicalJson(e.manifest) === canonicalJson(m);
    const age = now - time(e.completedAt),
      fresh = age >= 0 && age <= LIMITS.freshnessMs;
    const consistent = same && fresh && e.status === "pass";
    return {
      status: consistent ? "pass" : e.status === "fail" ? "fail" : "unknown",
      consistent,
      reusable: false,
      provenance: "unverified",
      productionReady: false,
      codes: [
        ...new Set([
          ...e.checks.filter((c) => c.status !== "pass").map((c) => c.code),
          ...(!same ? ["manifest_drift"] : []),
          ...(!fresh ? ["invalid_input"] : []),
        ]),
      ],
    };
  } catch {
    return {
      status: "unknown",
      consistent: false,
      reusable: false,
      provenance: "unverified",
      productionReady: false,
      codes: ["invalid_input"],
    };
  }
}
/** Render allowlisted canonical fields only; no raw errors, SQL or secret material. */
export function renderEvidence(value) {
  const e = parseEvidence(value);
  return `# Schema equivalence evidence\n\nOrigin: ${e.origin}\nRun: ${e.runId}\nStatus: ${e.status}\nSource: ${e.request.sourceSha}\nManifest: ${e.manifest.hash}\nCompleted: ${e.completedAt}\n\nProvenance: unverified. Reusable: false. Production ready: false. Enforced: false.\nCleanup deletion mode: recoverable.\n\n| Check | Status | Code |\n| --- | --- | --- |\n${e.checks.map((c) => `| ${c.id} | ${c.status} | ${c.code} |`).join("\n")}\n`;
}
