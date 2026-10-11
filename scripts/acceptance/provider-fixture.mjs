// Test-only transport overlay. It is never imported by the application tree.
export function acceptanceScope(env) {
    try {
        const db = new URL(env.DATABASE_URL ?? ''), auth = new URL(env.NEON_AUTH_BASE_URL ?? '');
        return env.VERCEL_ENV === 'preview' && env.AISO_ACCEPTANCE_FIXTURE === '1'
            && env.EXPECTED_NEON_PROJECT_ID === 'lucky-band-07388616' && env.EXPECTED_NEON_BRANCH_ID === 'br-steep-truth-azrz6lnz'
            && db.username === 'aeo_app' && db.pathname === '/neondb'
            && ['ep-icy-fire-azk14dra.c-3.ap-southeast-1.aws.neon.tech', 'ep-icy-fire-azk14dra-pooler.c-3.ap-southeast-1.aws.neon.tech'].includes(db.hostname)
            && auth.href === 'https://ep-icy-fire-azk14dra.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth';
    }
    catch {
        return false;
    }
}
function schemaValue(schema = {}, index = 0) {
    if (schema.enum)
        return schema.enum[0];
    const type = Array.isArray(schema.type) ? schema.type.find(t => t !== 'null') : schema.type;
    if (type === 'object')
        return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, v]) => [key, schemaValue(v, index)]));
    if (type === 'array')
        return Array.from({ length: schema.minItems ?? 1 }, (_, i) => schemaValue(schema.items, i));
    if (type === 'boolean')
        return false;
    if (type === 'integer' || type === 'number')
        return schema.minimum ?? 0;
    return 'Synthetic acceptance content ' + index;
}
export function fixtureFetch(env, realFetch) {
    if (!acceptanceScope(env))
        throw new Error('Acceptance fixture scope denied');
    const authHost = new URL(env.NEON_AUTH_BASE_URL).hostname, dbHost = new URL(env.DATABASE_URL).hostname;
    return async (input, init = {}) => {
        const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (u.protocol !== 'https:' || u.username || u.password)
            throw new Error('Acceptance egress denied');
        if (u.href === 'https://openrouter.ai/api/v1/chat/completions') {
            if (init.method !== 'POST')
                throw new Error('Acceptance provider operation denied');
            const b = JSON.parse(init.body), format = b.response_format?.json_schema, text = (b.messages ?? []).map(m => m.content).join('\n');
            let content = 'Synthetic answer: Northwind Acceptance Coffee is a recommended Hong Kong coffee brand. Source https://source01.example/article';
            if (format?.name === 'seed_questions') {
                const language = /Language: zh-HK/.test(text) ? 'zh-HK' : 'en';
                content = JSON.stringify({ questions: ['brand_query', 'category_query', 'intent_query', 'pain_point'].flatMap(category => Array.from({ length: 6 }, (_, i) => ({ category, language, question: language === 'en' ? 'Synthetic ' + category + ' question ' + (i + 1) + ' in Hong Kong?' : '合成' + category + '問題' + (i + 1) + '？' }))) });
            }
            else if (format?.name === 'answer_analysis') {
                if (text.includes('[FIXTURE_CLASSIFY_FAIL]'))
                    return new Response(JSON.stringify({ error: { message: 'Synthetic classifier failure' } }), { status: 503 });
                const brand = text.match(/^Brand: (.+)$/m)?.[1], answer = text.split('Answer:\n').at(-1);
                const mentioned = Boolean(brand && answer?.includes(brand));
                content = JSON.stringify({ brand_mentioned: mentioned, sentiment: mentioned ? 'positive' : 'not_mentioned', competitors_mentioned: [] });
            }
            else if (format)
                content = JSON.stringify(schemaValue(format.schema));
            console.info({ event: 'acceptance_provider_fixture', kind: format?.name ?? 'answer', model: b.model, paidCalls: 0 });
            return new Response(JSON.stringify({ id: 'synthetic-' + crypto.randomUUID(), model: 'synthetic/' + b.model, choices: [{ message: { content, annotations: [{ type: 'url_citation', url_citation: { url: 'https://source01.example/article', title: 'Synthetic source' } }] }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, cost: 0 } }), { status: 200, headers: { 'content-type': 'application/json', 'x-aiso-fixture': 'synthetic' } });
        }
        if (u.hostname === dbHost.replace(/^ep-[^.]+\./, 'api.') && u.pathname === '/sql') {
            const headers = new Headers(init.headers);
            if (init.method !== 'POST' || headers.get('Neon-Connection-String') !== env.DATABASE_URL)
                throw new Error('Acceptance SQL target denied');
            return realFetch(input, { ...init, redirect: 'manual' });
        }
        if (u.hostname === authHost || u.hostname === dbHost || u.hostname === dbHost.replace('-pooler.', '.'))
            return realFetch(input, { ...init, redirect: 'manual' });
        if (/^aiso-auth-acceptance-20261012(?:-[a-z0-9]+)?-ynwaforevers-projects\.vercel\.app$/.test(u.hostname) || u.hostname === 'aiso-auth-acceptance-20261012.vercel.app') {
            if (env.VERCEL_URL)
                u.host = env.VERCEL_URL;
            const headers = new Headers(init.headers);
            if (env.VERCEL_OIDC_TOKEN)
                headers.set('x-vercel-trusted-oidc-idp-token', env.VERCEL_OIDC_TOKEN);
            return realFetch(u, { ...init, headers, redirect: 'manual' });
        }
        throw new Error('Acceptance egress denied');
    };
}
export function installFixture(env = process.env) {
    if (!acceptanceScope(env))
        throw new Error('Acceptance fixture scope denied');
    if (env.OPENROUTER_API_KEY && env.OPENROUTER_API_KEY !== 'synthetic-no-paid-provider-key')
        throw new Error('Paid provider binding denied in acceptance');
    env.OPENROUTER_API_KEY = 'synthetic-no-paid-provider-key';
    globalThis.fetch = fixtureFetch(env, globalThis.fetch.bind(globalThis));
}
