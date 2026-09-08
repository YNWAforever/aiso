import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";
import { buildManifest, assertManifest } from "../../scripts/schema-equivalence/manifest.mjs";
import { canonicalJson, LIMITS } from "../../scripts/schema-equivalence/contract.mjs";

const baseline = "supabase/baseline/000_baseline_2026-08-31.sql";
const modules = ["contract", "manifest", "target", "neon-port", "runner", "local-ports"].map(n => `scripts/schema-equivalence/${n}.mjs`);
const harness = ["scripts/schema-equivalence.mjs", ...modules, "scripts/migrate.ts", "lib/schema/types.ts", "lib/schema/introspect.ts", "lib/schema/diff.ts", "lib/security/redact-secrets.ts", "package.json", "package-lock.json"];
const migrations = ["supabase/migrations/043_example.sql", "supabase/migrations/001_first.sql", "supabase/migrations/003_gap.sql"];
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const root = path.resolve("synthetic-root");
  const files = Object.fromEntries([baseline, ...harness, ...migrations].map(p => [p, Buffer.from(p + "\r\n")]));
  const relative = p => path.relative(root, p).split(path.sep).join("/");
  const ports = {
    root, sourceSha: "a".repeat(40),
    listFiles: dir => Object.keys(files).filter(p => path.posix.dirname(p) === relative(dir)).map(p => path.posix.basename(p)),
    readFile: p => { const data = files[relative(p)]; if (!data) throw Error("private path"); return data; },
    realpath: p => p,
  };
  return {files, ports};
}

describe("manifest binding", () => {
  it("preserves actual lexical migration order and numbering gaps", () => {
    const {ports} = fixture();
    const result = buildManifest(ports);
    expect(result.migrations.map(e => e.path)).toEqual([...migrations].sort());
    expect(result.harness.map(e => e.path)).toEqual([...harness].sort());
    const {hash, ...body} = result;
    expect(hash).toBe(digest(canonicalJson(body)));
    expect(() => assertManifest(result, structuredClone(result))).not.toThrow();
  });
  it.each([baseline, ...migrations, ...harness])("binds exact bytes of %s", p => {
    const {files, ports} = fixture();
    const before = buildManifest(ports);
    files[p] = Buffer.concat([files[p], Buffer.from([0, 255])]);
    const after = buildManifest(ports);
    expect(after.hash).not.toBe(before.hash);
    expect(() => assertManifest(before, after)).toThrow("Invalid schema manifest");
    expect([after.baseline, ...after.migrations, ...after.harness].find(e => e.path === p).sha256).toBe(digest(files[p]));
  });
  it("does not normalize CRLF bytes", () => {
    const {files, ports} = fixture();
    const before = buildManifest(ports);
    files[baseline] = Buffer.from(files[baseline].toString().replaceAll("\r\n", "\n"));
    expect(buildManifest(ports).hash).not.toBe(before.hash);
  });
  it.each(["supabase/migrations/099_new.sql", "scripts/schema-equivalence/new-helper.mjs"])("binds added and removed membership %s", p => {
    const {files, ports} = fixture();
    const before = buildManifest(ports);
    files[p] = Buffer.from("new");
    const after = buildManifest(ports);
    expect(after.hash).not.toBe(before.hash);
    delete files[p];
    expect(buildManifest(ports)).toEqual(before);
  });
  it.each([baseline, ...harness])("fails closed when required file is absent: %s", p => {
    const {files, ports} = fixture();
    delete files[p];
    expect(() => buildManifest(ports)).toThrow("Invalid schema manifest");
  });
  it.each(["../outside.sql", "/outside.sql", "a/../b.sql", "x\\y.sql", ".", "..", "C:evil.sql", "bad\0.sql", "x".repeat(241) + ".sql", "a//b.sql"])("rejects unsafe inventory %s", name => {
    const {ports} = fixture();
    ports.listFiles = () => [name];
    expect(() => buildManifest(ports)).toThrow("Invalid schema manifest");
  });
  it.each(["external", "prefix-sibling", "root-itself", "relative"])("rejects non-contained realpath %s", mode => {
    const {ports} = fixture();
    const root = ports.root;
    ports.realpath = p => p === root ? root : mode === "external" ? path.resolve("external/file") : mode === "prefix-sibling" ? root + "-other/file" : mode === "root-itself" ? root : "relative/file";
    expect(() => buildManifest(ports)).toThrow("Invalid schema manifest");
  });
  it("accepts an in-root symlink target", () => {
    const {ports} = fixture();
    const originalRead = ports.readFile;
    const original = path.join(ports.root, baseline);
    const resolved = path.join(ports.root, "internal.sql");
    ports.realpath = p => p === original ? resolved : p;
    ports.readFile = p => originalRead(p === resolved ? original : p);
    expect(buildManifest(ports).baseline.path).toBe(baseline);
  });
  it.each(["", "A".repeat(40), "a".repeat(39), "a".repeat(41)])("rejects invalid source SHA %s", sourceSha => {
    expect(() => buildManifest({...fixture().ports, sourceSha})).toThrow("Invalid schema manifest");
  });
  it.each(["migrations", "harness"])("bounds %s inventory", category => {
    const {files, ports} = fixture();
    for (let i = 0; i <= (category === "migrations" ? LIMITS.migrations : LIMITS.harnessFiles); i++)
      files[category === "migrations" ? `supabase/migrations/${i}.sql` : `scripts/schema-equivalence/${i}.mjs`] = Buffer.from("x");
    expect(() => buildManifest(ports)).toThrow("Invalid schema manifest");
  });
  it("rejects duplicate inventory", () => {
    const {ports} = fixture();
    const list = ports.listFiles;
    ports.listFiles = dir => { const names = list(dir); return [...names, names[0]]; };
    expect(() => buildManifest(ports)).toThrow("Invalid schema manifest");
  });
  it("requires at least one migration", () => {
    const {files, ports} = fixture();
    migrations.forEach(p => delete files[p]);
    expect(() => buildManifest(ports)).toThrow("Invalid schema manifest");
  });
  it("rejects decoded strings from readFile", () => {
    const {ports} = fixture(); ports.readFile = () => "decoded";
    expect(() => buildManifest(ports)).toThrow("Invalid schema manifest");
  });
  it("sanitizes port failures", () => {
    const {ports} = fixture(); ports.realpath = () => {throw Error("credential-private");};
    expect(() => buildManifest(ports)).toThrow(/^Invalid schema manifest$/);
  });
  it.each([
    m => {m.extra = true;},
    m => {m.version = 2;},
    m => {m.sourceSha = "bad";},
    m => {m.hash = "0".repeat(64);},
    m => {m.baseline.path = "../outside.sql";},
    m => {m.harness.pop();},
    m => {m.migrations.reverse();},
    m => {m.migrations.push(m.migrations[0]);},
    m => {m.baseline.sha256 = "bad";},
  ])("rejects identical malformed manifests before comparing", alter => {
    const m = buildManifest(fixture().ports); alter(m);
    expect(() => assertManifest(m, structuredClone(m))).toThrow("Invalid schema manifest");
  });
});

describe("manifest input boundaries", () => {
  it.each([null, undefined, {}, {root: "relative"}])("sanitizes malformed port envelopes", ports => {
    expect(() => buildManifest(ports)).toThrow(/^Invalid schema manifest$/);
  });
  it("binds source SHA changes", () => {
    const {ports} = fixture();
    const before = buildManifest(ports);
    const after = buildManifest({...ports, sourceSha: "b".repeat(40)});
    expect(() => assertManifest(before, after)).toThrow("Invalid schema manifest");
  });
  it.each([
    m => {m.harness = m.harness.filter(e => !e.path.endsWith("/runner.mjs"));},
    m => {m.migrations.reverse();},
    m => {m.baseline.path = "supabase/baseline/other.sql";},
    m => {m.harness.push({path: "unrelated/file.mjs", sha256: "a".repeat(64)}); m.harness.sort((a,b) => a.path < b.path ? -1 : 1);},
  ])("rejects malformed inventory even with recomputed matching hash", alter => {
    const m = buildManifest(fixture().ports);
    alter(m);
    const {hash: oldHash, ...body} = m;
    expect(oldHash).toMatch(/^[a-f0-9]{64}$/);
    m.hash = digest(canonicalJson(body));
    expect(() => assertManifest(m, structuredClone(m))).toThrow("Invalid schema manifest");
  });
});
