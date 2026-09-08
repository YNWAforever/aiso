/** Guarded, request-bound schema rehearsal CLI. Imports never run a rehearsal. */
import { realpathSync } from "node:fs";
import { open, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIMITS,
  parseRequest,
  parseEvidence,
  canonicalJson,
  renderEvidence,
} from "./schema-equivalence/contract.mjs";
import { runEquivalence } from "./schema-equivalence/runner.mjs";

function parseArgs(args) {
  if (!Array.isArray(args) || args.length !== 4) throw Error("invalid_input");
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i],
      value = args[i + 1];
    if (
      !["--request", "--output-dir"].includes(flag) ||
      Object.hasOwn(options, flag) ||
      typeof value !== "string" ||
      !value.trim() ||
      value.startsWith("--") ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      throw Error("invalid_input");
    options[flag] = value;
  }
  return options;
}

async function readRequest(file, limit) {
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw Error("invalid_input");
    // Read at most one byte beyond the cap, including if the file grows after stat.
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw Error("invalid_input");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, length),
    );
  } finally {
    await handle.close();
  }
}

/** Effects may be injected by synthetic tests; CLI flags never configure provenance. */
export async function main(args, env, ports = {}) {
  const log = ports.log ?? console.log,
    error = ports.error ?? console.error;
  try {
    const options = parseArgs(args);
    const raw = await (ports.readRequest ?? readRequest)(
      options["--request"],
      LIMITS.requestBytes,
    );
    if (
      typeof raw !== "string" ||
      Buffer.byteLength(raw, "utf8") > LIMITS.requestBytes
    )
      throw Error("invalid_input");
    const request = parseRequest(raw);
    const root = ports.root ?? fileURLToPath(new URL("../", import.meta.url));
    // Lazy loading also keeps TS-driver imports out of invalid-argument invocations.
    const local =
      ports.inspectLocalManifest && ports.createLocalPorts
        ? ports
        : await import("./schema-equivalence/local-ports.mjs");
    const manifest = await (
      ports.inspectLocalManifest ?? local.inspectLocalManifest
    )({ root, sourceSha: request.sourceSha });
    if (
      manifest.sourceSha !== request.sourceSha ||
      manifest.hash !== request.manifestHash
    )
      throw Error("invalid_input");
    const token = env?.NEON_API_KEY;
    if (
      typeof token !== "string" ||
      token.length === 0 ||
      token.length > 4096 ||
      /[^\x21-\x7e]/.test(token)
    )
      throw Error("invalid_input");
    const runtime = (ports.createLocalPorts ?? local.createLocalPorts)({
      root,
      token,
      request,
      fetch: ports.fetch ?? globalThis.fetch,
    });
    const result = await (ports.runEquivalence ?? runEquivalence)(
      request,
      runtime,
    );
    // Runner has already completed cleanup and its final filesystem observation.
    const evidence = parseEvidence(result.evidence);
    if (
      canonicalJson(evidence.request) !== canonicalJson(request) ||
      canonicalJson(evidence.manifest) !== canonicalJson(manifest)
    )
      throw Error("invalid_input");
    const json = canonicalJson(evidence) + "\n",
      markdown = renderEvidence(evidence);
    const output = path.resolve(options["--output-dir"]);
    const jsonPath = path.join(output, `schema-${evidence.runId}.json`);
    const markdownPath = path.join(output, `schema-${evidence.runId}.md`);
    await (ports.mkdir ?? mkdir)(output, { recursive: true });
    await (ports.writeFile ?? writeFile)(jsonPath, json, {
      encoding: "utf8",
      flag: "wx",
    });
    log(`Schema evidence JSON: ${JSON.stringify(jsonPath)}`);
    await (ports.writeFile ?? writeFile)(markdownPath, markdown, {
      encoding: "utf8",
      flag: "wx",
    });
    log(`Schema evidence Markdown: ${JSON.stringify(markdownPath)}`);
    log("Schema rehearsal complete; production readiness is not established");
    return result.exitCode === 0 && evidence.status === "pass" ? 0 : 1;
  } catch {
    error("Schema rehearsal failed");
    return 1;
  }
}
function isEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
if (isEntry())
  main(process.argv.slice(2), process.env)
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error("Schema rehearsal failed");
      process.exitCode = 1;
    });
