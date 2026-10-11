// Default mode is READ ONLY. This runner never creates/baselines the ledger.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { digest, validatePacket, validateApproval } from './migration-packet.mjs';
// @ts-expect-error -- Node executes this repo's existing TypeScript SQL guard.
import { assertNoTransactionControl } from '../migrate.ts';
const args = process.argv.slice(2), apply = args.includes('--apply'), value = k => args[args.indexOf(k) + 1];
if (args.some(a => a.startsWith('--') && !['--packet', '--approval', '--claim', '--out', '--apply'].includes(a)))
    throw Error('Unknown release option');
if (!args.includes('--packet') || !args.includes('--out'))
    throw Error('Explicit packet and private receipt paths required');
const bytes = readFileSync(value('--packet')), packet = validatePacket(JSON.parse(bytes)), packetHash = digest(bytes), result = { at: new Date().toISOString(), mode: apply ? 'APPROVED_APPLY' : 'READ_ONLY', packetSha256: packetHash, target: packet.target, migrations: [], status: 'unverified' };
const sqlBodies = new Map();
const files = readdirSync('supabase/migrations').filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();
for (const m of packet.migrations) {
    const body = readFileSync(resolve('supabase/migrations', m.file));
    if (digest(body) !== m.sha256)
        throw Error('Migration file hash mismatch');
    assertNoTransactionControl(m.file, body.toString());
    sqlBodies.set(m.file, body.toString());
}
if (apply) {
    if (!args.includes('--approval') || !args.includes('--claim') || !args.includes('--packet') || !process.env.DATABASE_URL)
        throw Error('Approval/claim/app binding required');
    validateApproval(packet, JSON.parse(readFileSync(value('--approval'))), packetHash);
    if (existsSync(value('--claim')))
        throw Error('Retained claim: reconcile READ ONLY; do not retry');
}
const ownerUrl = process.env.MIGRATE_DATABASE_URL;
if (!ownerUrl)
    throw Error('Owner binding required');
function binding(url, role) { let u; try {
    u = new URL(url);
}
catch {
    throw Error('Malformed scoped database binding');
} if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:')
    throw Error('Database protocol denied'); if (decodeURIComponent(u.username) !== role || decodeURIComponent(u.pathname.slice(1)) !== packet.target.database)
    throw Error('Credential role/database mismatch'); return url; }
const c = new Client({ connectionString: binding(ownerUrl, packet.target.ownerRole), connectionTimeoutMillis: 10000, query_timeout: 45000 });
c.on('error', () => { });
async function identity(client, role) { const row = (await client.query("SELECT current_setting('neon.project_id',true) project,current_setting('neon.branch_id',true) branch,current_database() database,current_user role,current_setting('transaction_read_only') read_only")).rows[0]; if (row.project !== packet.target.project || row.branch !== packet.target.branch || row.database !== packet.target.database || row.role !== role || row.read_only !== 'on')
    throw Error('In-band exact target/read-only boundary denied'); return row; }
async function snapshot() { await c.query('BEGIN READ ONLY'); try {
    await c.query("SET LOCAL statement_timeout='10s'");
    const observed = await identity(c, packet.target.ownerRole);
    const ledger = (await c.query('SELECT filename,checksum FROM public.schema_migrations ORDER BY filename')).rows;
    const columns = (await c.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
    const constraints = (await c.query("SELECT c.relname AS table_name,t.conname,t.contype,pg_get_constraintdef(t.oid) AS definition FROM pg_constraint t JOIN pg_class c ON c.oid=t.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,t.conname")).rows;
    const indexes = (await c.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
    await c.query('COMMIT');
    return { observed, ledger, schemaSha256: digest(JSON.stringify({ columns, constraints, indexes })), ledgerSha256: digest(JSON.stringify(ledger)) };
}
catch (e) {
    await c.query('ROLLBACK').catch(() => { });
    throw e;
} }
try {
    await c.connect();
    const pre = await snapshot();
    result.preflight = { observed: pre.observed, schemaSha256: pre.schemaSha256, ledgerSha256: pre.ledgerSha256, pending: files.filter(f => !pre.ledger.some(r => r.filename === f)) };
    if (pre.schemaSha256 !== packet.schemaSha256 || pre.ledgerSha256 !== packet.ledgerSha256 || JSON.stringify(result.preflight.pending) !== JSON.stringify(packet.migrations.map(m => m.file)))
        throw Error('Schema/ledger/pending packet drift; re-review');
    if (!apply) {
        result.status = 'preflight_passed_awaiting_authorization';
    }
    else {
        writeFileSync(value('--claim'), JSON.stringify({ packetSha256: packetHash, claimedAt: new Date().toISOString(), state: 'claimed_unknown_until_receipt' }), { flag: 'wx', mode: 0o600 });
        await c.query('SELECT pg_advisory_lock(741028063)');
        for (const m of packet.migrations) {
            const body = sqlBodies.get(m.file);
            await c.query('BEGIN');
            try {
                await c.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
                await c.query(body);
                await c.query('INSERT INTO public.schema_migrations(filename,checksum) VALUES($1,$2)', [m.file, m.sha256]);
                await c.query('COMMIT');
                result.migrations.push(m);
                writeFileSync(value('--out'), JSON.stringify(result, null, 2));
            }
            catch (e) {
                await c.query('ROLLBACK').catch(() => { });
                throw e;
            }
        }
        const post = await snapshot();
        const rows = post.ledger.filter(r => packet.migrations.some(m => m.file === r.filename));
        if (rows.length !== 8 || rows.some(r => r.checksum !== packet.migrations.find(m => m.file === r.filename).sha256))
            throw Error('Exact ledger readback mismatch');
        result.postLedger = rows;
        const app = new Client({ connectionString: binding(process.env.DATABASE_URL, packet.target.appRole), connectionTimeoutMillis: 10000, query_timeout: 10000 });
        app.on('error', () => { });
        try {
            await app.connect();
            await app.query('BEGIN READ ONLY');
            await identity(app, packet.target.appRole);
            const grants = (await app.query("SELECT has_table_privilege(current_user,'public.pulse_runs','INSERT') run_insert,has_column_privilege(current_user,'public.pulse_item_attempts','grounding','UPDATE') grounding_update,has_column_privilege(current_user,'public.pulse_item_attempts','search_evidence','UPDATE') search_update,has_table_privilege(current_user,'public.pulse_item_attempts','UPDATE') full_attempt_update,has_table_privilege(current_user,'public.pulse_item_attempts','DELETE') attempt_delete")).rows[0];
            await app.query('COMMIT');
            if (!grants.run_insert || !grants.grounding_update || !grants.search_update || grants.full_attempt_update || grants.attempt_delete)
                throw Error('Application privilege readback mismatch');
            result.appGrants = grants;
        }
        finally {
            await app.end().catch(() => { });
        }
        result.status = 'applied_with_ledger_and_app_role_readback';
    }
}
catch (e) {
    result.status = 'blocked_or_partial_reconcile_read_only';
    result.errorCode = typeof e.code === 'string' ? e.code : 'boundary_or_readback_failure';
    process.exitCode = 1;
}
finally {
    writeFileSync(value('--out'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ mode: result.mode, status: result.status, packetSha256: packetHash, appliedFiles: result.migrations.map(m => m.file), errorCode: result.errorCode }));
    await c.end().catch(() => { });
}
