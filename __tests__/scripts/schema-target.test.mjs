import { describe, it, expect } from "vitest";
import { createTargetRegistry } from "../../scripts/schema-equivalence/target.mjs";
const startedAt = Date.parse("2026-09-08T00:00:00.123Z");
const request = {
  version: 1,
  sourceSha: "a".repeat(40),
  manifestHash: "b".repeat(64),
  projectId: "synthetic-project",
  parentId: "br-parent",
  database: "synthetic_db",
  role: "synthetic_owner",
  protectedBranchIds: ["br-protected"],
  protectedHosts: ["protected.neon.tech"],
  sterilityReference: "synthetic",
};
const branch = {
  id: "br-child",
  project_id: request.projectId,
  parent_id: request.parentId,
  name: "synthetic-child",
  expires_at: "2026-09-08T02:00:00Z",
  default: false,
  protected: false,
};
const endpoints = [
  {
    id: "ep-child",
    branch_id: "br-child",
    host: "ep-child.region.neon.tech",
    type: "read_write",
  },
];
const uri =
  "postgresql://synthetic_owner:SECRET@ep-child.region.neon.tech/synthetic_db?sslmode=require";
const session = {
  projectId: request.projectId,
  branchId: "br-child",
  database: request.database,
  role: request.role,
};
function setup(change = {}) {
  const registry = createTargetRegistry(request);
  const handle = registry.register({
    branch: { ...branch, ...change },
    endpoints,
    name: branch.name,
    startedAt,
  });
  return { registry, handle };
}
describe("strict child registry", () => {
  it("registers normalized observed identity before URI exists, then guards sessions", () => {
    const { registry, handle } = setup();
    expect(handle.child.expiresAt).toBe("2026-09-08T02:00:00.000Z");
    expect(registry.cleanupCandidate()).toBe(handle);
    expect(() => registry.assertSession(handle, session)).toThrow();
    registry.register({ handle, uri });
    expect(registry.assertSession(handle, session)).toEqual(session);
    expect(handle.connectionUri).toBe(uri);
    expect(JSON.stringify(handle)).not.toContain("SECRET");
  });
  it.each([
    { project_id: "foreign" },
    { parent_id: "br-other" },
    { id: "br-parent" },
    { id: "br-protected" },
    { id: "bad" },
    { name: "other" },
    { default: true },
    { default: undefined },
    { protected: true },
    { protected: undefined },
    { primary: true },
    { expires_at: undefined },
    { expires_at: "2026-09-08T02:00:01Z" },
  ])("rejects unproven child %j", (change) => {
    const registry = createTargetRegistry(request);
    expect(() =>
      registry.register({
        branch: { ...branch, ...change },
        endpoints,
        name: branch.name,
        startedAt,
      }),
    ).toThrow();
    expect(registry.cleanupCandidate()).toBeNull();
  });
  it("rejects forged handles and substituted URI", () => {
    const { registry, handle } = setup();
    registry.register({ handle, uri });
    expect(() =>
      registry.assertSession({ ...handle, connectionUri: uri }, session),
    ).toThrow();
    expect(() =>
      registry.register({ handle, uri: uri.replace("SECRET", "OTHER") }),
    ).toThrow();
    expect(() => registry.cleanupCandidate({ ...handle })).toThrow();
  });
  it.each(["projectId", "branchId", "database", "role"])(
    "checks observed %s on both sessions",
    (field) => {
      const { registry, handle } = setup();
      registry.register({ handle, uri });
      for (const side of ["A", "B"]) {
        expect(side).toBeTruthy();
        expect(() =>
          registry.assertSession(handle, { ...session, [field]: "wrong" }),
        ).toThrow();
      }
    },
  );
  it.each([
    uri.replace("synthetic_owner", "wrong"),
    uri.replace("/synthetic_db", "/wrong"),
    uri.replace("ep-child.region", "ep-other.region"),
    uri.replace("ep-child.region.neon.tech", "protected.neon.tech"),
    uri.replace("postgresql:", "https:"),
    uri.replace("neon.tech/", "neon.tech:444/"),
    uri + "&host=protected.neon.tech",
    uri + "#secret",
    uri.replace("ep-child.region", "ep-child-pooler.region"),
  ])("rejects wrong or ambiguous URI while retaining cleanup", (bad) => {
    const { registry, handle } = setup();
    expect(() => registry.register({ handle, uri: bad })).toThrow();
    expect(registry.cleanupCandidate()).toBe(handle);
  });
  it.each([
    { branch_id: "br-other" },
    { host: "protected.neon.tech" },
    { host: "ep-child.region.neon.tech/path" },
    { id: "bad" },
    { type: "read_only" },
  ])("rejects endpoint %j before session", (change) => {
    const registry = createTargetRegistry(request);
    const handle = registry.register({
      branch,
      endpoints: [{ ...endpoints[0], ...change }],
      name: branch.name,
      startedAt,
    });
    expect(() => registry.register({ handle, uri })).toThrow();
    expect(registry.cleanupCandidate()).toBe(handle);
  });
  it("forgets identity and refuses duplicate registration", () => {
    const { registry, handle } = setup();
    expect(() =>
      registry.register({ branch, endpoints, name: branch.name, startedAt }),
    ).toThrow();
    registry.forget(handle);
    expect(registry.cleanupCandidate()).toBeNull();
    expect(() => registry.assertSession(handle, session)).toThrow();
  });
  it("uses fixed error codes without serializing caller material", () => {
    const registry = createTargetRegistry(request);
    let caught;
    try {
      registry.register({
        branch: { ...branch, name: "SECRET" },
        endpoints,
        name: branch.name,
        startedAt,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toBe("possible_orphan");
    expect(caught.code).toBe("possible_orphan");
    expect(JSON.stringify(caught)).not.toContain("SECRET");
  });
  it.each([null, undefined, {}, "SECRET"])(
    "sanitizes invalid registry request %j",
    (input) => {
      expect(() => createTargetRegistry(input)).toThrow("invalid_input");
    },
  );
  it.each([null, undefined, {}, "SECRET"])(
    "rejects malformed handles with fixed code %j",
    (handle) => {
      const { registry } = setup();
      expect(() => registry.assertSession(handle, session)).toThrow(
        "identity_mismatch",
      );
      expect(() => registry.forget(handle)).toThrow("identity_mismatch");
    },
  );
  it("does not let external mutations alter stored endpoint or branch proof", () => {
    const r = createTargetRegistry(request);
    const raw = { ...branch },
      eps = [{ ...endpoints[0] }];
    const h = r.register({
      branch: raw,
      endpoints: eps,
      name: branch.name,
      startedAt,
    });
    raw.id = "br-protected";
    eps[0].host = "protected.neon.tech";
    r.register({ handle: h, uri });
    expect(h.child.id).toBe(branch.id);
    expect(() => {
      h.child.id = "br-protected";
    }).toThrow();
    expect(() => {
      h.connectionUri = "SECRET";
    }).toThrow();
    expect(r.assertSession(h, session)).toEqual(session);
  });
});
