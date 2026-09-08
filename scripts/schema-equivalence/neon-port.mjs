import { parseRequest, LIMITS } from "./contract.mjs";
import {
  assertRegistryRequest,
  childExpectation,
  proveChild,
  lifecycleError,
} from "./target.mjs";

const API = "https://console.neon.tech/api/v2";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pending = new Set(["scheduling", "running", "cancelling"]);
const terminalFailure = new Set(["failed", "error", "cancelled", "skipped"]);
const check = (condition, code = "identity_mismatch") => {
  if (!condition) throw lifecycleError(code);
};
const path = (request) =>
  `${API}/projects/${encodeURIComponent(request.projectId)}`;
const defaultSleep = (ms, { signal } = {}) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(lifecycleError("timeout"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(lifecycleError("timeout"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });

/** Direct REST, with no mutation retry and no environment or SDK configuration. */
export function createNeonPort(options) {
  const { token, fetch, now = Date.now, sleep = defaultSleep } = options ?? {};
  check(
    typeof token === "string" &&
      token.length > 0 &&
      token.length <= 4096 &&
      !/\s/.test(token) &&
      typeof fetch === "function" &&
      typeof now === "function" &&
      typeof sleep === "function",
    "invalid_input",
  );
  const children = new WeakMap(),
    attemptedRegistries = new WeakSet(),
    dispatchedRegistries = new WeakSet();
  const clock = () => {
    const value = now();
    check(Number.isSafeInteger(value), "invalid_input");
    return value;
  };
  // Race even non-cooperative fetch/body/sleep ports. Late completions never advance state.
  async function bounded(work, duration, signal) {
    check(duration > 0 && !signal?.aborted, "timeout");
    const controller = new AbortController(),
      deadline = clock() + duration;
    let timer, abort;
    const timeout = new Promise((resolve, reject) => {
      abort = () => {
        controller.abort();
        reject(lifecycleError("timeout"));
      };
      timer = setTimeout(abort, duration);
      signal?.addEventListener("abort", abort, { once: true });
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => work(controller.signal)),
        timeout,
      ]);
      check(!controller.signal.aborted && clock() < deadline, "timeout");
      return result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.abort();
    }
  }
  async function http(
    url,
    {
      method = "GET",
      body,
      statuses = [200],
      signal,
      budget = LIMITS.httpMs,
      code = "identity_unavailable",
      onDispatch,
    } = {},
  ) {
    let reader;
    try {
      return await bounded(
        async (abortSignal) => {
          check(!abortSignal.aborted, "timeout");
          onDispatch?.();
          const response = await fetch(url, {
            method,
            redirect: "error",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              ...(body ? { "Content-Type": "application/json" } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: abortSignal,
          });
          check(!abortSignal.aborted, "timeout");
          check(
            response &&
              !response.redirected &&
              statuses.includes(response.status),
            code,
          );
          if (response.status === 204) return { status: 204, data: null };
          check(
            /^application\/json(?:\s*;|$)/i.test(
              response.headers?.get("content-type") ?? "",
            ),
            code,
          );
          const length = response.headers.get("content-length");
          check(
            length === null ||
              (/^\d+$/.test(length) && Number(length) <= LIMITS.apiBytes),
            code,
          );
          check(
            response.body && typeof response.body.getReader === "function",
            code,
          );
          reader = response.body.getReader();
          let size = 0;
          const chunks = [];
          for (;;) {
            const { done, value } = await reader.read();
            check(!abortSignal.aborted, "timeout");
            if (done) break;
            check(value instanceof Uint8Array, code);
            size += value.byteLength;
            check(size <= LIMITS.apiBytes, code);
            chunks.push(value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          const data = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          );
          check(data && typeof data === "object" && !Array.isArray(data), code);
          return { status: response.status, data };
        },
        Math.min(LIMITS.httpMs, budget),
        signal,
      );
    } catch (error) {
      throw lifecycleError(error?.code === "timeout" ? "timeout" : code);
    } finally {
      if (reader) void reader.cancel().catch(() => {});
    }
  }
  const context = (handle) => {
    const ctx = children.get(handle);
    check(ctx, "identity_mismatch");
    ctx.registry.cleanupCandidate(handle);
    check(!ctx.identityRejected, "cleanup_unverified");
    return ctx;
  };
  function operationIdentity(operation, ctx, original) {
    check(
      operation &&
        typeof operation.id === "string" &&
        uuid.test(operation.id) &&
        operation.project_id === ctx.request.projectId &&
        typeof operation.action === "string" &&
        /^[a-z][a-z0-9_]{0,127}$/.test(operation.action),
    );
    check(
      operation.branch_id === undefined ||
        operation.branch_id === ctx.handle.child.id,
    );
    check(
      operation.endpoint_id === undefined ||
        ctx.endpointIds.includes(operation.endpoint_id),
    );
    if (original) {
      check(
        operation.id === original.id && operation.action === original.action,
      );
      check(
        original.endpoint_id === undefined ||
          operation.endpoint_id === undefined ||
          operation.endpoint_id === original.endpoint_id,
      );
    }
    check(
      operation.status === "finished" ||
        pending.has(operation.status) ||
        terminalFailure.has(operation.status),
      "operation_failed",
    );
  }
  async function operations(values, ctx, signal) {
    return bounded(
      (groupSignal) => pollOperations(values, ctx, groupSignal),
      LIMITS.operationMs,
      signal,
    );
  }
  async function pollOperations(values, ctx, signal) {
    check(
      Array.isArray(values) && values.length <= LIMITS.operationPolls,
      "operation_failed",
    );
    const unique = new Set();
    const remaining = values.map((value) => {
      operationIdentity(value, ctx);
      check(!terminalFailure.has(value.status), "operation_failed");
      check(!unique.has(value.id), "identity_mismatch");
      unique.add(value.id);
      return {
        id: value.id,
        action: value.action,
        endpoint_id: value.endpoint_id,
      };
    });
    const deadline = clock() + LIMITS.operationMs;
    let polls = 0;
    while (remaining.length) {
      for (let i = 0; i < remaining.length;) {
        check(polls < LIMITS.operationPolls && clock() < deadline, "timeout");
        const original = remaining[i];
        polls++;
        const { data } = await http(
          `${path(ctx.request)}/operations/${encodeURIComponent(original.id)}`,
          { signal, budget: deadline - clock(), code: "operation_failed" },
        );
        operationIdentity(data.operation, ctx, original);
        if (data.operation.status === "finished") remaining.splice(i, 1);
        else {
          check(pending.has(data.operation.status), "operation_failed");
          i++;
        }
      }
      if (remaining.length) {
        check(polls < LIMITS.operationPolls && clock() < deadline, "timeout");
        await bounded(
          (abortSignal) =>
            sleep(Math.min(LIMITS.operationPollMs, deadline - clock()), {
              signal: abortSignal,
            }),
          deadline - clock(),
          signal,
        );
      }
    }
  }
  const port = {
    async readProject({ request: value, signal } = {}) {
      const request = parseRequest(value);
      const { data } = await http(path(request), { signal });
      check(data.project?.id === request.projectId);
      return { projectId: data.project.id };
    },
    async readParent({ request: value, signal } = {}) {
      const request = parseRequest(value);
      const { data } = await http(
        `${path(request)}/branches/${encodeURIComponent(request.parentId)}`,
        { signal },
      );
      check(
        data.branch?.id === request.parentId &&
          data.branch.project_id === request.projectId,
      );
      check(
        data.branch.protected === false &&
          !request.protectedBranchIds.includes(data.branch.id),
        "protected_target",
      );
      return { projectId: data.branch.project_id, id: data.branch.id };
    },
    async createChild({
      request: value,
      registry,
      name,
      startedAt,
      signal,
    } = {}) {
      const request = parseRequest(value);
      assertRegistryRequest(registry, request);
      check(
        registry.cleanupCandidate() === null &&
          !attemptedRegistries.has(registry),
        "invalid_input",
      );
      const expected = childExpectation(name, startedAt);
      check(
        clock() >= startedAt && clock() < Date.parse(expected.expiresAt),
        "invalid_input",
      );
      check(!signal?.aborted, "timeout");
      attemptedRegistries.add(registry);
      const { data } = await http(`${path(request)}/branches`, {
        method: "POST",
        body: {
          branch: {
            name,
            parent_id: request.parentId,
            expires_at: expected.expiresAt,
          },
          endpoints: [{ type: "read_write" }],
        },
        statuses: [201],
        signal,
        code: "possible_orphan",
        onDispatch: () => dispatchedRegistries.add(registry),
      });
      const handle = registry.register({
        branch: data.branch,
        endpoints: data.endpoints,
        name,
        startedAt,
      });
      const ctx = {
        request,
        registry,
        handle,
        endpointIds: Array.isArray(data.endpoints)
          ? data.endpoints
              .filter(
                (e) =>
                  e?.branch_id === handle.child.id &&
                  typeof e?.id === "string" &&
                  /^ep-[a-z0-9][a-z0-9-]{0,56}$/.test(e.id),
              )
              .map((e) => e.id)
          : [],
        ready: false,
        identityRejected: false,
        deleteAttempted: false,
        deleteDispatched: false,
        deleteCompleted: false,
      };
      children.set(handle, ctx); // Retain original child diagnostics even if fresh identity rejects.
      check(
        Array.isArray(data.endpoints) &&
          data.endpoints.length > 0 &&
          Array.isArray(data.roles) &&
          Array.isArray(data.databases),
        "operation_failed",
      );
      await operations(data.operations, ctx, signal);
      const fresh = await http(
        `${path(request)}/branches/${encodeURIComponent(handle.child.id)}`,
        { signal },
      );
      try {
        const observed = proveChild(
          request,
          fresh.data.branch,
          name,
          startedAt,
        );
        check(observed.id === handle.child.id);
      } catch (error) {
        // A returned child that no longer proves disposable revokes mutation authority.
        // Transport/operation failures above leave the originally proven cleanup intact.
        ctx.identityRejected = true;
        throw error;
      }
      ctx.ready = true;
      return handle;
    },
    async connectionUri({ handle, signal } = {}) {
      const ctx = context(handle);
      check(ctx.ready && !ctx.deleteAttempted, "identity_mismatch");
      const query = new URLSearchParams({
        branch_id: handle.child.id,
        database_name: ctx.request.database,
        role_name: ctx.request.role,
        pooled: "false",
      });
      const { data } = await http(
        `${path(ctx.request)}/connection_uri?${query}`,
        { signal },
      );
      ctx.registry.register({ handle, uri: data.uri });
      return handle.connectionUri;
    },
    async deleteChild({ handle, signal } = {}) {
      const ctx = context(handle);
      check(!ctx.deleteAttempted, "cleanup_failed");
      check(!signal?.aborted, "timeout");
      ctx.deleteAttempted = true;
      const { status, data } = await http(
        `${path(ctx.request)}/branches/${encodeURIComponent(handle.child.id)}`,
        {
          method: "DELETE",
          statuses: [200, 204],
          signal,
          code: "cleanup_failed",
          onDispatch: () => {
            ctx.deleteDispatched = true;
          },
        },
      );
      if (status === 200) {
        check(
          data.branch?.id === handle.child.id &&
            data.branch.project_id === ctx.request.projectId,
          "cleanup_failed",
        );
        await operations(data.operations, ctx, signal);
      }
      ctx.deleteCompleted = true;
      return { attempted: true, deletionMode: "recoverable" };
    },
    async confirmAbsent({ handle, signal } = {}) {
      const ctx = context(handle);
      check(ctx.deleteCompleted, "cleanup_unverified");
      try {
        const project = await http(path(ctx.request), { signal });
        check(
          project.data.project?.id === ctx.request.projectId,
          "cleanup_unverified",
        );
        const child = await http(
          `${path(ctx.request)}/branches/${encodeURIComponent(handle.child.id)}`,
          { statuses: [404], signal, code: "cleanup_unverified" },
        );
        check(
          typeof child.data.code === "string" && child.data.code.length > 0,
          "cleanup_unverified",
        );
        return {
          status: "pass",
          attempted: true,
          confirmed: true,
          checkedAt: new Date(clock()).toISOString(),
          deletionMode: "recoverable",
        };
      } catch {
        throw lifecycleError("cleanup_unverified");
      }
    },
  };
  return Object.freeze(
    Object.fromEntries(
      Object.entries(port).map(([name, method]) => [
        name,
        async (input) => {
          try {
            return await method(input);
          } catch (error) {
            const sanitized = lifecycleError(
              [
                "identity_mismatch",
                "identity_unavailable",
                "protected_target",
                "possible_orphan",
                "operation_failed",
                "timeout",
                "cleanup_failed",
                "cleanup_unverified",
              ].includes(error?.code)
                ? error.code
                : "invalid_input",
            );
            if (name === "createChild")
              sanitized.mutationAttempted = dispatchedRegistries.has(
                input?.registry,
              );
            if (name === "deleteChild")
              sanitized.mutationAttempted =
                children.get(input?.handle)?.deleteDispatched === true;
            if (name === "connectionUri")
              sanitized.mutationAttempted = children.has(input?.handle);
            throw sanitized;
          }
        },
      ]),
    ),
  );
}
