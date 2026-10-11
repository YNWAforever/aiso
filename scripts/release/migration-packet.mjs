import { createHash } from 'node:crypto';
const sha = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const same = (a, b) => Object.keys(a).length === Object.keys(b ?? {}).length && Object.entries(a).every(([k, v]) => b[k] === v);
const deny = () => { throw new Error('Release packet boundary denied'); };
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function validatePacket(p) {
    if (!p || p.version !== 1 || p.kind !== 'aiso-063-070' || !/^[a-f0-9]{40}$/.test(p.sourceSha ?? '') || !sha(p.schemaSha256) || !sha(p.ledgerSha256))
        deny();
    const t = p.target;
    if (!t || Object.keys(t).length !== 5 || !/^[A-Za-z0-9_-]{1,128}$/.test(t.project ?? '') || !/^br-[A-Za-z0-9_-]+$/.test(t.branch ?? '') || t.database !== 'neondb' || t.ownerRole !== 'neondb_owner' || t.appRole !== 'aeo_app')
        deny();
    if (!Array.isArray(p.migrations) || p.migrations.length !== 8 || p.migrations.some((m, i) => !new RegExp('^' + String(63 + i).padStart(3, '0') + '_[a-z0-9_]+\\.sql$').test(m.file ?? '') || !sha(m.sha256)))
        deny();
    return p;
}
export function validateApproval(packet, a, packetHash, now = Date.now()) {
    validatePacket(packet);
    if (!a || a.packetSha256 !== packetHash || !sha(packetHash) || typeof a.humanAuthorization !== 'string' || a.humanAuthorization.trim().length < 8)
        deny();
    const approved = Date.parse(a.approvedAt), expires = Date.parse(a.expiresAt);
    if (!Number.isFinite(approved) || !Number.isFinite(expires) || approved > now || expires <= now || expires - approved > 2 * 3600000)
        deny();
    for (const evidence of [a.backup, a.runtime]) {
        const at = Date.parse(evidence?.createdAt ?? evidence?.observedAt);
        if (!evidence || !same(packet.target, evidence.target) || !Number.isFinite(at) || at > now || now - at > 30 * 60000)
            deny();
    }
    if (!a.backup.id || a.backup.restoreVerified !== true || !sha(a.backup.restoreReceiptSha256) || a.runtime.sourceSha !== packet.sourceSha || !/^dpl_[A-Za-z0-9]+$/.test(a.runtime.deploymentId ?? '') || a.runtime.databaseIdentity !== 'pass' || a.runtime.readOnly !== 'pass')
        deny();
    return a;
}
