/** Injected orchestration; importing this module never provisions or connects. */
import { buildEvidence, parseRequest, CLASSES, CODES } from "./contract.mjs";
import { assertManifest } from "./manifest.mjs";

const failure = (code) => Object.assign(new Error(code), { code });
const codeOf = (error, fallback) =>
  CODES.includes(error?.code) &&
  ![
    "matched",
    "completed",
    "equivalent",
    "nothing_pending",
    "unchanged",
    "absent",
  ].includes(error.code)
    ? error.code
    : fallback;
const clean = (value, pattern, max) =>
  typeof value === "string" && value.length <= max && pattern.test(value)
    ? value
    : null;
function sessionObservation(value) {
  return {
    projectId: clean(value?.projectId, /^[a-z0-9-]+$/, 60),
    branchId: clean(value?.branchId, /^br-[a-z0-9-]+$/, 60),
    database: clean(value?.database, /^[a-z_][a-z0-9_]*$/, 63),
    role: clean(value?.role, /^[a-z_][a-z0-9_]*$/, 63),
  };
}
function assertLedger(rows, manifest, side) {
  // Ordinary migration rows intentionally have NULL checksums. The byte manifest
  // plus successful execution binds their source; the ledger proves membership.
  const expected = manifest.migrations.map((entry) => ({
    filename: entry.path.split("/").at(-1),
    checksum: null,
  }));
  if (side === "B")
    expected.push({
      filename: manifest.baseline.path.split("/").at(-1),
      checksum: manifest.baseline.sha256,
    });
  expected.sort((a, b) =>
    a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0,
  );
  if (
    !Array.isArray(rows) ||
    rows.length !== expected.length ||
    rows.some(
      (row, i) =>
        !row ||
        row.filename !== expected[i].filename ||
        row.checksum !== expected[i].checksum,
    )
  )
    throw failure("operation_failed");
}
function summarizeDiff(diff) {
  const classes = {};
  for (const name of CLASSES) {
    const item = diff?.classes?.[name];
    if (
      !item ||
      !["onlyInLegacy", "onlyInBaseline", "changed"].every((k) =>
        Array.isArray(item[k]),
      )
    )
      throw failure("operation_failed");
    classes[name] = {
      missing: item.onlyInLegacy.length,
      extra: item.onlyInBaseline.length,
      changed: item.changed.length,
    };
  }
  if (typeof diff.equivalent !== "boolean") throw failure("operation_failed");
  const pass =
    diff.equivalent &&
    Object.values(classes).every((c) => Object.values(c).every((n) => n === 0));
  return { status: pass ? "pass" : "fail", classes };
}

/**
 * Invalid requests/manifests reject before observing lifecycle ports. After this
 * boundary every failure is recorded only after the single outer cleanup finally.
 * ports.manifest MUST rebuild the filesystem and recheck clean expected HEAD.
 */
export async function runEquivalence(value, ports) {
  let request, manifest, observations, startedAt;
  try {
    request = parseRequest(value);
    manifest = structuredClone(await ports.manifest());
    assertManifest(manifest, manifest);
    if (
      manifest.hash !== request.manifestHash ||
      manifest.sourceSha !== request.sourceSha
    )
      throw failure("invalid_input");
    startedAt = ports.now();
    if (!Number.isSafeInteger(startedAt)) throw failure("invalid_input");
    observations = {
      version: 1,
      kind: "schema-equivalence",
      origin: ports.origin,
      enforced: false,
      productionReady: false,
      runId: ports.runId(),
      request,
      manifest,
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(startedAt).toISOString(),
      sessions: { A: null, B: null },
      paths: { A: null, B: null },
    };
    buildEvidence(observations);
  } catch {
    throw failure("invalid_input");
  }
  const checks = new Map([
    [
      "manifest",
      { id: "manifest", status: "unknown", code: "dependency_failed" },
    ],
  ]);
  const failCheck = (id, code) => checks.set(id, { id, status: "fail", code });
  let stage = "parent",
    creationAttempted = false;
  try {
    await ports.neon.readProject({ request });
    observations.parent = await ports.neon.readParent({ request });
    stage = "child";
    let handle;
    try {
      handle = await ports.neon.createChild({
        request,
        registry: ports.registry,
        name: `equiv-${observations.runId}`,
        startedAt,
      });
      creationAttempted = true;
    } catch (error) {
      creationAttempted = error?.mutationAttempted === true;
      throw error;
    }
    observations.child = handle.child;
    await ports.neon.connectionUri({ handle });
    const snapshots = {};
    for (const side of ["A", "B"]) {
      stage = "session" + side;
      await ports.reset(handle, side, (observed) => {
        observations.sessions[side] = sessionObservation(observed);
        ports.registry.assertSession(handle, observed);
        stage = "path" + side;
      });
      // No callback means no observed session and therefore no further mutation.
      if (stage !== "path" + side) throw failure("identity_unavailable");
      if (side === "B") await ports.applyBaseline(handle, manifest);
      await ports.applyMigrations(handle, side);
      assertLedger(await ports.ledger(handle), manifest, side);
      snapshots[side] = await ports.introspect(handle, side);
      observations.paths[side] = {
        status: "pass",
        headManifestHash: manifest.hash,
      };
    }
    stage = "bootstrap";
    const bootstrap = await ports.dryRun(handle);
    const nothingPending =
      bootstrap?.ok === true &&
      typeof bootstrap.output === "string" &&
      bootstrap.output.includes("Nothing to apply");
    observations.bootstrap = {
      status: nothingPending ? "pass" : "fail",
      nothingPending,
    };
    stage = "comparison";
    observations.comparison = summarizeDiff(
      await ports.diff(snapshots.A, snapshots.B),
    );
  } catch (error) {
    failCheck(
      stage,
      codeOf(
        error,
        stage === "bootstrap" ? "bootstrap_failed" : "operation_failed",
      ),
    );
  } finally {
    const handle = ports.registry.cleanupCandidate();
    if (handle) {
      // Retain this diagnostic identity even if fresh readback revoked authority.
      // The lifecycle port, not candidate existence, decides whether DELETE is safe.
      observations.child = handle.child;
      let attempted = false;
      try {
        const deleted = await ports.neon.deleteChild({ handle });
        attempted = deleted?.attempted === true;
        const cleanup = await ports.neon.confirmAbsent({ handle });
        if (
          !attempted ||
          cleanup?.status !== "pass" ||
          cleanup.attempted !== true ||
          cleanup.confirmed !== true ||
          cleanup.deletionMode !== "recoverable" ||
          typeof cleanup.checkedAt !== "string" ||
          new Date(cleanup.checkedAt).toISOString() !== cleanup.checkedAt ||
          Date.parse(cleanup.checkedAt) < startedAt
        )
          throw failure("cleanup_unverified");
        observations.cleanup = {
          status: "pass",
          attempted: true,
          confirmed: true,
          checkedAt: cleanup.checkedAt,
          deletionMode: "recoverable",
        };
        ports.registry.forget(handle);
      } catch (error) {
        const code = codeOf(error, "cleanup_failed");
        // Only provider dispatch metadata proves an attempted DELETE. A retained
        // diagnostic candidate can have revoked mutation authority.
        observations.cleanup = {
          status: "fail",
          attempted: attempted || error?.mutationAttempted === true,
          confirmed: false,
          checkedAt: null,
          deletionMode: "recoverable",
        };
        failCheck("cleanup", code);
      }
    } else if (creationAttempted) {
      observations.cleanup = {
        status: "fail",
        attempted: false,
        confirmed: false,
        checkedAt: null,
        deletionMode: "recoverable",
      };
      failCheck("cleanup", "cleanup_unverified");
    }
  }
  try {
    assertManifest(manifest, await ports.manifest());
    checks.delete("manifest");
  } catch {
    failCheck("manifest", "manifest_drift");
  }
  let completedAt;
  try {
    completedAt = ports.now();
  } catch {
    completedAt = startedAt;
    failCheck("manifest", "operation_failed");
  }
  if (!Number.isSafeInteger(completedAt) || completedAt < startedAt) {
    completedAt = startedAt;
    failCheck("manifest", "operation_failed");
  }
  // A confirmed absence timestamp is itself a clock observation at completion.
  completedAt = Math.max(
    completedAt,
    Date.parse(observations.cleanup?.checkedAt) || startedAt,
  );
  observations.completedAt = new Date(completedAt).toISOString();
  observations.checks = [...checks.values()];
  const evidence = buildEvidence(observations);
  return { evidence, exitCode: evidence.status === "pass" ? 0 : 1 };
}
