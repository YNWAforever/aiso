import { parseRequest, canonicalJson, LIMITS } from "./contract.mjs";

const registries = new WeakMap();
const branchId = /^br-[a-z0-9][a-z0-9-]{0,56}$/;
const endpointId = /^ep-[a-z0-9][a-z0-9-]{0,56}$/;
const dns =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export function lifecycleError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
const requireThat = (condition, code = "identity_mismatch") => {
  if (!condition) throw lifecycleError(code);
};

/** Internal adapter boundary: only this module's registry for the same complete request. */
export function assertRegistryRequest(registry, request) {
  requireThat(
    registries.get(registry) === canonicalJson(parseRequest(request)),
    "invalid_input",
  );
}
export function childExpectation(name, startedAt) {
  requireThat(
    typeof name === "string" &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(name) &&
      Number.isSafeInteger(startedAt),
    "invalid_input",
  );
  const expiry = Math.floor((startedAt + LIMITS.ttlMs) / 1000) * 1000;
  requireThat(
    Number.isSafeInteger(expiry) &&
      expiry > startedAt &&
      Number.isFinite(new Date(expiry).getTime()),
    "invalid_input",
  );
  return { name, expiresAt: new Date(expiry).toISOString() };
}
/** Returns only observed, normalized child fields, never expected substitutes. */
export function proveChild(request, branch, name, startedAt) {
  const expected = childExpectation(name, startedAt);
  requireThat(
    branch &&
      typeof branch.id === "string" &&
      branchId.test(branch.id) &&
      branch.project_id === request.projectId &&
      branch.parent_id === request.parentId &&
      branch.name === name,
    "possible_orphan",
  );
  requireThat(
    branch.id !== request.parentId &&
      !request.protectedBranchIds.includes(branch.id) &&
      branch.default === false &&
      branch.protected === false &&
      branch.primary !== true,
    "possible_orphan",
  );
  requireThat(
    typeof branch.expires_at === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
        branch.expires_at,
      ) &&
      Date.parse(branch.expires_at) === Date.parse(expected.expiresAt),
    "possible_orphan",
  );
  return Object.freeze({
    projectId: branch.project_id,
    id: branch.id,
    parentId: branch.parent_id,
    name: branch.name,
    expiresAt: new Date(branch.expires_at).toISOString(),
  });
}

/** Private same-process identity registry. Registration and URI binding are separate. */
export function createTargetRegistry(value) {
  let request;
  try {
    request = parseRequest(value);
  } catch {
    throw lifecycleError("invalid_input");
  }
  const created = new Map();
  const get = (handle) => {
    const entry = created.get(handle?.child?.id);
    requireThat(entry && entry.handle === handle);
    return entry;
  };
  const registry = Object.freeze({
    register(input) {
      try {
        if (input?.handle) {
          const entry = get(input.handle),
            uri = input.uri;
          requireThat(typeof uri === "string" && uri.length <= LIMITS.apiBytes);
          const url = new URL(uri);
          requireThat(
            ["postgresql:", "postgres:"].includes(url.protocol) &&
              !url.hash &&
              (!url.port || url.port === "5432") &&
              dns.test(url.hostname),
          );
          requireThat(
            !url.hostname.includes("-pooler.") &&
              !request.protectedHosts.some(
                (host) =>
                  host.replace("-pooler.", ".") ===
                  url.hostname.replace("-pooler.", "."),
              ),
            "protected_target",
          );
          requireThat(
            decodeURIComponent(url.username) === request.role &&
              decodeURIComponent(url.pathname.slice(1)) === request.database &&
              url.password.length > 0,
          );
          // URI options cannot override routing, authentication, or database selection.
          const allowed = new Set(["sslmode", "channel_binding"]);
          requireThat(
            [...url.searchParams.keys()].every((key) => allowed.has(key)) &&
              [...url.searchParams.keys()].length ===
                new Set(url.searchParams.keys()).size,
          );
          requireThat(
            ["require", "verify-ca", "verify-full"].includes(
              url.searchParams.get("sslmode"),
            ) &&
              (!url.searchParams.has("channel_binding") ||
                ["require", "prefer", "disable"].includes(
                  url.searchParams.get("channel_binding"),
                )),
          );
          requireThat(
            entry.endpoints.some(
              (endpoint) =>
                typeof endpoint.id === "string" &&
                endpointId.test(endpoint.id) &&
                endpoint.branch_id === entry.handle.child.id &&
                endpoint.type === "read_write" &&
                dns.test(endpoint.host) &&
                endpoint.host === url.hostname,
            ),
          );
          requireThat(entry.uri === null || entry.uri === uri);
          entry.uri = uri;
          return entry.handle;
        }
        requireThat(created.size === 0, "possible_orphan");
        const child = proveChild(
          request,
          input?.branch,
          input?.name,
          input?.startedAt,
        );
        const entry = {
          uri: null,
          endpoints: Array.isArray(input.endpoints)
            ? input.endpoints.map((e) => ({
                id: e?.id,
                branch_id: e?.branch_id,
                host: e?.host,
                type: e?.type,
              }))
            : [],
        };
        const handle = Object.freeze(
          Object.defineProperties(
            { child },
            { connectionUri: { enumerable: false, get: () => entry.uri } },
          ),
        );
        entry.handle = handle;
        created.set(child.id, entry);
        return handle;
      } catch (error) {
        throw lifecycleError(
          ["possible_orphan", "protected_target", "invalid_input"].includes(
            error?.code,
          )
            ? error.code
            : "identity_mismatch",
        );
      }
    },
    assertSession(handle, observed) {
      const entry = get(handle);
      requireThat(entry.uri !== null && handle.connectionUri === entry.uri);
      requireThat(
        observed?.projectId === request.projectId &&
          observed?.branchId === handle.child.id &&
          observed?.database === request.database &&
          observed?.role === request.role,
      );
      return {
        projectId: observed.projectId,
        branchId: observed.branchId,
        database: observed.database,
        role: observed.role,
      };
    },
    cleanupCandidate(handle) {
      if (handle !== undefined) return get(handle).handle;
      return created.values().next().value?.handle ?? null;
    },
    forget(handle) {
      get(handle);
      created.delete(handle.child.id);
    },
  });
  registries.set(registry, canonicalJson(request));
  return registry;
}
