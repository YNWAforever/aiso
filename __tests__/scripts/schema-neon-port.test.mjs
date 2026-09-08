import { describe, it, expect, vi, afterEach } from "vitest";
import { createTargetRegistry } from "../../scripts/schema-equivalence/target.mjs";
import { createNeonPort } from "../../scripts/schema-equivalence/neon-port.mjs";
const start = Date.parse("2026-09-08T00:00:00.123Z");
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
const endpoint = {
  id: "ep-child",
  branch_id: branch.id,
  host: "ep-child.region.neon.tech",
  type: "read_write",
};
const op = {
  id: "12345678-1234-1234-1234-123456789abc",
  project_id: request.projectId,
  branch_id: branch.id,
  endpoint_id: endpoint.id,
  action: "create_timeline",
  status: "finished",
};
const creation = {
  branch,
  endpoints: [endpoint],
  operations: [op],
  roles: [],
  databases: [],
};
const uri =
  "postgresql://synthetic_owner:SECRET@ep-child.region.neon.tech/synthetic_db?sslmode=require";
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
function fixture(overrides = {}) {
  let time = start;
  const calls = [];
  const fetch = vi.fn(async (url, options) => {
    calls.push({ url, options });
    if (overrides.respond) return overrides.respond(url, options, calls);
    if (options.method === "POST") return json(creation, 201);
    if (options.method === "DELETE")
      return json({
        branch,
        operations: [{ ...op, action: "timeline_archive" }],
      });
    if (url.includes("/operations/"))
      return json({
        operation: {
          ...op,
          action: calls.some((c) => c.options.method === "DELETE")
            ? "timeline_archive"
            : op.action,
        },
      });
    if (url.includes("/connection_uri")) return json({ uri });
    if (url.endsWith("/branches/br-child"))
      return calls.some((c) => c.options.method === "DELETE")
        ? json({ code: "NOT_FOUND" }, 404)
        : json({ branch });
    if (url.endsWith("/branches/br-parent"))
      return json({
        branch: { ...branch, id: request.parentId, default: true },
      });
    return json({ project: { id: request.projectId } });
  });
  const port = createNeonPort({
    token: "TOKEN_SENTINEL",
    fetch,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    ...overrides.ports,
  });
  const registry = createTargetRegistry(request);
  return {
    port,
    registry,
    calls,
    fetch,
    advance: (ms) => {
      time += ms;
    },
    create: () =>
      port.createChild({
        request,
        registry,
        name: branch.name,
        startedAt: start,
      }),
  };
}
afterEach(() => vi.useRealTimers());
describe("bounded Neon REST lifecycle", () => {
  it("rejects malformed endpoint operation identity while retaining the proven child", async () => {
    const f = fixture({
      respond: (url, options) =>
        options.method === "POST"
          ? json(
              {
                ...creation,
                endpoints: [{ ...endpoint, id: "ep--" }],
                operations: [{ ...op, endpoint_id: "ep--" }],
              },
              201,
            )
          : json({ branch }),
    });
    await expect(f.create()).rejects.toMatchObject({
      code: "identity_mismatch",
      mutationAttempted: true,
    });
    expect(f.registry.cleanupCandidate().child.id).toBe(branch.id);
    expect(f.calls).toHaveLength(1);
  });

  it("uses explicit parent, floor-second TTL, fixed origin and exact full lifecycle", async () => {
    const f = fixture();
    expect(await f.port.readProject({ request })).toEqual({
      projectId: request.projectId,
    });
    expect(await f.port.readParent({ request })).toEqual({
      projectId: request.projectId,
      id: request.parentId,
    });
    const h = await f.create();
    expect(
      JSON.parse(f.calls.find((c) => c.options.method === "POST").options.body),
    ).toEqual({
      branch: {
        name: branch.name,
        parent_id: request.parentId,
        expires_at: "2026-09-08T02:00:00.000Z",
      },
      endpoints: [{ type: "read_write" }],
    });
    expect(await f.port.connectionUri({ handle: h })).toBe(uri);
    expect(await f.port.deleteChild({ handle: h })).toEqual({
      attempted: true,
      deletionMode: "recoverable",
    });
    expect(await f.port.confirmAbsent({ handle: h })).toEqual({
      status: "pass",
      attempted: true,
      confirmed: true,
      checkedAt: new Date(start).toISOString(),
      deletionMode: "recoverable",
    });
    expect(f.calls.filter((c) => c.options.method === "POST")).toHaveLength(1);
    expect(f.calls.filter((c) => c.options.method === "DELETE")).toHaveLength(
      1,
    );
    for (const c of f.calls) {
      expect(
        c.url.startsWith(
          "https://console.neon.tech/api/v2/projects/synthetic-project",
        ),
      ).toBe(true);
      expect(c.options.redirect).toBe("error");
      expect(c.options.headers.Authorization).toBe("Bearer TOKEN_SENTINEL");
      expect(c.url + c.options.body).not.toContain("TOKEN_SENTINEL");
    }
  });
  it.each(["failed", "error", "cancelled", "skipped", "unknown"])(
    "keeps safe cleanup target after creation operation %s",
    async (status) => {
      const f = fixture({
        respond: (url, o) =>
          o.method === "POST"
            ? json(creation, 201)
            : json({ operation: { ...op, status, error: "SECRET" } }),
      });
      await expect(f.create()).rejects.toMatchObject({
        code: "operation_failed",
      });
      expect(f.registry.cleanupCandidate().child.id).toBe(branch.id);
      expect(f.calls.filter((c) => c.options.method === "POST")).toHaveLength(
        1,
      );
    },
  );
  it.each([
    { project_id: "foreign" },
    { parent_id: "br-other" },
    { default: true },
    { protected: true },
    { id: "br-protected" },
  ])("never deletes unproven response %j", async (change) => {
    const f = fixture({
      respond: () =>
        json({ ...creation, branch: { ...branch, ...change } }, 201),
    });
    await expect(f.create()).rejects.toMatchObject({ code: "possible_orphan" });
    expect(f.registry.cleanupCandidate()).toBeNull();
    await expect(
      f.port.deleteChild({ handle: { child: branch } }),
    ).rejects.toThrow();
    expect(f.calls.filter((c) => c.options.method === "DELETE")).toHaveLength(
      0,
    );
  });
  it.each([
    { id: "12345678-1234-1234-1234-123456789abd" },
    { project_id: "foreign" },
    { branch_id: "br-other" },
    { endpoint_id: "ep-other" },
    { action: "wrong" },
  ])("rejects changed operation identity %j", async (change) => {
    const f = fixture({
      respond: (url, o) =>
        o.method === "POST"
          ? json(creation, 201)
          : json({ operation: { ...op, ...change } }),
    });
    await expect(f.create()).rejects.toMatchObject({
      code: "identity_mismatch",
    });
    expect(f.registry.cleanupCandidate()).not.toBeNull();
  });
  it("accepts omitted optional operation branch/endpoint identifiers", async () => {
    const { branch_id, endpoint_id, ...minimal } = op;
    expect(branch_id && endpoint_id).toBeTruthy();
    const f = fixture({
      respond: (url, o) =>
        o.method === "POST"
          ? json({ ...creation, operations: [minimal] }, 201)
          : url.includes("/operations/")
            ? json({ operation: minimal })
            : json({ branch }),
    });
    await expect(f.create()).resolves.toBeTruthy();
  });
  it.each(["scheduling", "running", "cancelling"])(
    "bounds pending status %s to 120 reads without mutation retries",
    async (status) => {
      const f = fixture({
        respond: (url, o) =>
          o.method === "POST"
            ? json(creation, 201)
            : json({ operation: { ...op, status } }),
      });
      await expect(f.create()).rejects.toMatchObject({ code: "timeout" });
      expect(
        f.calls.filter((c) => c.url.includes("/operations/")),
      ).toHaveLength(120);
      expect(f.calls.filter((c) => c.options.method === "POST")).toHaveLength(
        1,
      );
    },
  );
  it.each([
    { default: true },
    { protected: true },
    { primary: true },
    { project_id: "foreign" },
    { parent_id: "br-other" },
    { name: "other-child" },
    { id: "br-other" },
    { expires_at: "2026-09-09T02:00:00Z" },
  ])(
    "revokes mutations after contradictory child readback %j",
    async (change) => {
      const f = fixture({
        respond: (url, o) =>
          o.method === "POST"
            ? json(creation, 201)
            : o.method === "DELETE"
              ? new Response(null, { status: 204 })
              : url.includes("/operations/")
                ? json({ operation: op })
                : json({ branch: { ...branch, ...change } }),
      });
      await expect(f.create()).rejects.toThrow();
      const handle = f.registry.cleanupCandidate();
      expect(handle.child.id).toBe(branch.id);
      await expect(f.port.deleteChild({ handle })).rejects.toMatchObject({
        code: "cleanup_unverified",
        mutationAttempted: false,
      });
      await expect(f.port.confirmAbsent({ handle })).rejects.toMatchObject({
        code: "cleanup_unverified",
      });
      await expect(f.port.connectionUri({ handle })).rejects.toThrow();
      expect(f.calls.filter((c) => c.options.method === "DELETE")).toHaveLength(
        0,
      );
      expect(
        f.calls.filter((c) => c.url.includes("/connection_uri")),
      ).toHaveLength(0);
    },
  );
  it.each(["network", "operation"])(
    "preserves cleanup after %s readiness failure",
    async (kind) => {
      const f = fixture({
        respond: (url, o) => {
          if (o.method === "POST") return json(creation, 201);
          if (o.method === "DELETE") return new Response(null, { status: 204 });
          if (url.includes("/operations/"))
            return json({
              operation: {
                ...op,
                status: kind === "operation" ? "failed" : "finished",
              },
            });
          throw Error("SECRET");
        },
      });
      await expect(f.create()).rejects.toThrow();
      await expect(
        f.port.deleteChild({ handle: f.registry.cleanupCandidate() }),
      ).resolves.toMatchObject({ attempted: true });
      expect(f.calls.filter((c) => c.options.method === "DELETE")).toHaveLength(
        1,
      );
    },
  );
  it("retains safe child on URI failure and rejects forged deletion handles", async () => {
    const f = fixture();
    const h = await f.create();
    f.fetch.mockImplementationOnce(async () => json({ error: "SECRET" }, 403));
    await expect(f.port.connectionUri({ handle: h })).rejects.toMatchObject({
      code: "identity_unavailable",
    });
    expect(f.registry.cleanupCandidate()).toBe(h);
    await expect(f.port.deleteChild({ handle: { ...h } })).rejects.toThrow();
    await expect(f.port.deleteChild({ handle: h })).resolves.toBeTruthy();
  });
  it("requires successful deletion before fresh absence readback", async () => {
    const f = fixture();
    const h = await f.create();
    await expect(f.port.confirmAbsent({ handle: h })).rejects.toMatchObject({
      code: "cleanup_unverified",
    });
    f.fetch.mockImplementationOnce(async () =>
      json({ branch, operations: [op] }),
    );
    f.fetch.mockImplementationOnce(async () =>
      json({ operation: { ...op, status: "failed" } }),
    );
    await expect(f.port.deleteChild({ handle: h })).rejects.toThrow();
    await expect(f.port.confirmAbsent({ handle: h })).rejects.toMatchObject({
      code: "cleanup_unverified",
    });
    await expect(f.port.deleteChild({ handle: h })).rejects.toThrow();
    expect(
      f.calls.filter((c) => c.options.method === "DELETE").length,
    ).toBeLessThanOrEqual(1);
  });
  it("accepts 204 without body only after fresh matching project and child JSON404", async () => {
    const f = fixture();
    const h = await f.create();
    f.fetch.mockImplementationOnce(
      async () => new Response(null, { status: 204 }),
    );
    await f.port.deleteChild({ handle: h });
    f.fetch.mockImplementationOnce(async () =>
      json({ project: { id: request.projectId } }),
    );
    f.fetch.mockImplementationOnce(async () =>
      json({ code: "NOT_FOUND" }, 404),
    );
    await expect(f.port.confirmAbsent({ handle: h })).resolves.toMatchObject({
      confirmed: true,
    });
  });
  it.each(["wrong-project", "html", "forbidden", "present", "network"])(
    "never infers absence from %s",
    async (kind) => {
      const f = fixture();
      const h = await f.create();
      await f.port.deleteChild({ handle: h });
      f.fetch.mockImplementationOnce(async () =>
        json({
          project: {
            id: kind === "wrong-project" ? "foreign" : request.projectId,
          },
        }),
      );
      if (kind !== "wrong-project")
        f.fetch.mockImplementationOnce(async () => {
          if (kind === "network") throw Error("SECRET");
          if (kind === "html")
            return new Response("<html>SECRET</html>", {
              status: 404,
              headers: { "content-type": "text/html" },
            });
          return json(
            kind === "present" ? { branch } : { code: "DENIED" },
            kind === "present" ? 200 : 403,
          );
        });
      await expect(f.port.confirmAbsent({ handle: h })).rejects.toMatchObject({
        code: "cleanup_unverified",
      });
    },
  );
  it.each(["redirect", "oversize", "malformed", "transport"])(
    "bounds and sanitizes %s HTTP failure",
    async (kind) => {
      const f = fixture({
        respond: () => {
          if (kind === "transport") throw Error("TOKEN_SENTINEL SECRET");
          if (kind === "redirect") return { status: 200, redirected: true };
          if (kind === "oversize") return json({ x: "x".repeat(1048576) });
          return new Response("{SECRET", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });
      await expect(f.port.readProject({ request })).rejects.toMatchObject({
        code: "identity_unavailable",
        message: "identity_unavailable",
      });
      expect(f.calls).toHaveLength(1);
    },
  );
  it("aborts fetch at 20 seconds even when transport ignores cancellation", async () => {
    vi.useFakeTimers();
    let signal;
    const f = fixture({
      ports: {
        now: () => Date.now(),
        fetch: async (u, o) => {
          signal = o.signal;
          return new Promise(() => {});
        },
      },
    });
    const pending = expect(
      f.port.readProject({ request }),
    ).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(20000);
    await pending;
    expect(signal.aborted).toBe(true);
  });
  it("bounds stalled response body and rejects late completed network response", async () => {
    vi.useFakeTimers();
    const f = fixture({
      ports: {
        now: () => Date.now(),
        fetch: async () =>
          new Response(new ReadableStream({ start() {} }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      },
    });
    const pending = expect(
      f.port.readProject({ request }),
    ).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(20000);
    await pending;
    const late = fixture({
      respond: () => {
        late.advance(20001);
        return json({ project: { id: request.projectId } });
      },
    });
    await expect(late.port.readProject({ request })).rejects.toMatchObject({
      code: "timeout",
    });
  });
  it("honors caller cancellation before dispatch", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.port.readProject({ request, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(f.calls).toHaveLength(0);
  });
  it("refuses registry from a different full request before POST", async () => {
    const f = fixture();
    const other = createTargetRegistry({ ...request, role: "different" });
    await expect(
      f.port.createChild({
        request,
        registry: other,
        name: branch.name,
        startedAt: start,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(f.calls).toHaveLength(0);
  });
  it("does not acquire a URI for a child whose readiness operation failed", async () => {
    const f = fixture({
      respond: (url, o) =>
        o.method === "POST"
          ? json(creation, 201)
          : json({ operation: { ...op, status: "failed" } }),
    });
    await expect(f.create()).rejects.toThrow();
    await expect(
      f.port.connectionUri({ handle: f.registry.cleanupCandidate() }),
    ).rejects.toMatchObject({ code: "identity_mismatch" });
    expect(f.calls.some((c) => c.url.includes("/connection_uri"))).toBe(false);
  });
  it.each(["failed", "error", "cancelled", "skipped", "unknown"])(
    "rejects original creation operation status %s before polling",
    async (status) => {
      const f = fixture({
        respond: (url, o) =>
          o.method === "POST"
            ? json({ ...creation, operations: [{ ...op, status }] }, 201)
            : url.includes("/operations/")
              ? json({ operation: op })
              : json({ branch }),
      });
      await expect(f.create()).rejects.toMatchObject({
        code: "operation_failed",
      });
      expect(f.calls).toHaveLength(1);
    },
  );
  it("passes only the remaining group budget to the final operation HTTP", async () => {
    vi.useFakeTimers();
    let count = 0,
      signal;
    const f = fixture({
      respond: (url, o) => {
        if (o.method === "POST") return json(creation, 201);
        count++;
        if (count <= 7) {
          f.advance(15000);
          return json({ operation: { ...op, status: "running" } });
        }
        signal = o.signal;
        return new Promise(() => {});
      },
    });
    const pending = expect(f.create()).rejects.toMatchObject({
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(count).toBe(8);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(7999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(signal.aborted).toBe(true);
    expect(f.calls.filter((c) => c.options.method === "POST")).toHaveLength(1);
  });
  it("prevents late cancelled POST completion from registering a child", async () => {
    vi.useFakeTimers();
    let complete;
    const f = fixture({
      ports: {
        fetch: () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      },
    });
    const pending = expect(f.create()).rejects.toMatchObject({
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(20000);
    await pending;
    complete(json(creation, 201));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.registry.cleanupCandidate()).toBeNull();
  });
  it("bounds stalled injected sleep and honours in-flight caller cancellation", async () => {
    vi.useFakeTimers();
    const f = fixture({
      respond: (url, o) =>
        o.method === "POST"
          ? json(creation, 201)
          : json({ operation: { ...op, status: "running" } }),
      ports: { sleep: () => new Promise(() => {}) },
    });
    const pending = expect(f.create()).rejects.toMatchObject({
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(120000);
    await pending;
    const controller = new AbortController();
    const other = fixture({ ports: { fetch: () => new Promise(() => {}) } });
    const cancelled = expect(
      other.port.readProject({ request, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "timeout" });
    controller.abort();
    await cancelled;
  });
  it.each([null, undefined, {}, { request: { projectId: "TOKEN_SENTINEL" } }])(
    "sanitizes malformed public arguments %j",
    async (input) => {
      const f = fixture();
      for (const method of [
        "readProject",
        "readParent",
        "createChild",
        "connectionUri",
        "deleteChild",
        "confirmAbsent",
      ])
        await expect(f.port[method](input)).rejects.toMatchObject({
          message: expect.stringMatching(/^(invalid_input|identity_mismatch)$/),
          code: expect.stringMatching(/^(invalid_input|identity_mismatch)$/),
        });
      expect(f.calls).toHaveLength(0);
    },
  );
  it("never repeats an ambiguous POST within the same registry", async () => {
    const f = fixture({
      respond: () => {
        throw Error("SECRET");
      },
    });
    await expect(f.create()).rejects.toMatchObject({ code: "possible_orphan" });
    await expect(f.create()).rejects.toMatchObject({ code: "invalid_input" });
    expect(f.calls.filter((c) => c.options.method === "POST")).toHaveLength(1);
  });
  it("counts a failed DELETE exactly once without retry", async () => {
    let deletionCalls = 0;
    const f = fixture();
    const h = await f.create();
    f.fetch.mockImplementationOnce(async () => {
      deletionCalls++;
      throw Error("SECRET");
    });
    await expect(f.port.deleteChild({ handle: h })).rejects.toMatchObject({
      code: "cleanup_failed",
    });
    await expect(f.port.deleteChild({ handle: h })).rejects.toMatchObject({
      code: "cleanup_failed",
    });
    expect(deletionCalls).toBe(1);
    expect(f.registry.cleanupCandidate()).toBe(h);
  });
  it.each([
    { operations: undefined },
    { operations: [{ ...op, id: "bad" }] },
    { operations: [op, op] },
    { endpoints: undefined },
    { roles: undefined },
    { databases: undefined },
  ])(
    "retains proven identity for malformed remaining create metadata %j",
    async (change) => {
      const f = fixture({
        respond: () => json({ ...creation, ...change }, 201),
      });
      await expect(f.create()).rejects.toThrow();
      expect(f.registry.cleanupCandidate()?.child.id).toBe(branch.id);
    },
  );
  it("binds returned operation endpoint identity when both responses contain it", async () => {
    const second = {
      ...endpoint,
      id: "ep-second",
      host: "ep-second.region.neon.tech",
    };
    const f = fixture({
      respond: (url, o) =>
        o.method === "POST"
          ? json({ ...creation, endpoints: [endpoint, second] }, 201)
          : url.includes("/operations/")
            ? json({ operation: { ...op, endpoint_id: second.id } })
            : json({ branch }),
    });
    await expect(f.create()).rejects.toMatchObject({
      code: "identity_mismatch",
    });
  });
  it("enforces real group timer even when an injected wall clock stops advancing", async () => {
    vi.useFakeTimers();
    let polls = 0;
    const f = fixture({
      respond: (url, options) => {
        if (options.method === "POST") return json(creation, 201);
        polls++;
        return new Promise((resolve) =>
          setTimeout(
            () => resolve(json({ operation: { ...op, status: "running" } })),
            19000,
          ),
        );
      },
      ports: { sleep: async () => {} },
    });
    let done = false;
    const result = f.create().catch((error) => {
      done = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(120000);
    expect(done).toBe(true);
    if (!done) await vi.advanceTimersByTimeAsync(2400000);
    expect(await result).toMatchObject({ code: "timeout" });
    expect(polls).toBeLessThanOrEqual(7);
  });
  it("never confirms deletion with a still-pending delete operation", async () => {
    const f = fixture();
    const handle = await f.create();
    let deletes = 0;
    f.fetch.mockImplementation(async (url, options) => {
      if (options.method === "DELETE") {
        deletes++;
        return json({
          branch,
          operations: [{ ...op, action: "timeline_archive" }],
        });
      }
      return json({
        operation: { ...op, action: "timeline_archive", status: "running" },
      });
    });
    await expect(f.port.deleteChild({ handle })).rejects.toMatchObject({
      code: "timeout",
    });
    await expect(f.port.confirmAbsent({ handle })).rejects.toMatchObject({
      code: "cleanup_unverified",
    });
    await expect(f.port.deleteChild({ handle })).rejects.toThrow();
    expect(deletes).toBe(1);
  });
  it("distinguishes predispatch cancellation from ambiguous create timeout without leaking diagnostics", async () => {
    const controller = new AbortController();
    controller.abort();
    const f = fixture();
    await expect(
      f.port.createChild({
        request,
        registry: f.registry,
        name: branch.name,
        startedAt: start,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "timeout", mutationAttempted: false });
    const ambiguous = fixture({
      respond: () => {
        throw Error("SECRET");
      },
    });
    await expect(ambiguous.create()).rejects.toMatchObject({
      code: "possible_orphan",
      mutationAttempted: true,
    });
    expect(ambiguous.registry.cleanupCandidate()).toBeNull();
  });
  it.each([null, undefined, {}, { child: branch }])(
    "reports no DELETE dispatch for malformed or foreign handle %j",
    async (handle) => {
      const f = fixture();
      await expect(f.port.deleteChild({ handle })).rejects.toMatchObject({
        mutationAttempted: false,
      });
      expect(f.calls).toHaveLength(0);
    },
  );
  it("reports no DELETE dispatch for pre-aborted valid handle and allows later cleanup", async () => {
    const f = fixture();
    const handle = await f.create();
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.port.deleteChild({ handle, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "timeout", mutationAttempted: false });
    expect(f.calls.filter((c) => c.options.method === "DELETE")).toHaveLength(
      0,
    );
    await expect(f.port.deleteChild({ handle })).resolves.toMatchObject({
      attempted: true,
    });
    expect(f.calls.filter((c) => c.options.method === "DELETE")).toHaveLength(
      1,
    );
  });
  it.each(["transport", "response", "operation"])(
    "retains actual DELETE dispatch evidence after %s failure and retry refusal",
    async (kind) => {
      const f = fixture();
      const handle = await f.create();
      let deletes = 0;
      f.fetch.mockImplementation(async (url, options) => {
        if (options.method === "DELETE") {
          deletes++;
          if (kind === "transport") throw Error("SECRET");
          if (kind === "response") return json({ error: "SECRET" }, 403);
          return json({
            branch,
            operations: [{ ...op, action: "timeline_archive" }],
          });
        }
        return json({
          operation: {
            ...op,
            action: "timeline_archive",
            status: "failed",
            error: "SECRET",
          },
        });
      });
      const error = await f.port
        .deleteChild({ handle })
        .catch((error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
        code: kind === "operation" ? "operation_failed" : "cleanup_failed",
        mutationAttempted: true,
      });
      expect(JSON.stringify(error)).not.toContain("SECRET");
      await expect(f.port.deleteChild({ handle })).rejects.toMatchObject({
        code: "cleanup_failed",
        mutationAttempted: true,
      });
      expect(deletes).toBe(1);
    },
  );
});
