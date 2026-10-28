import type {Context, Hono} from 'hono';
import type {Bindings} from '../index';
import {adminMiddleware} from '../middleware/admin';
import {ensureDao} from '../db';
import {newToken, readTriggers, runScheduled} from '../automation';
import {readLog} from '../edge';
import {sha256Hex} from '../edge/tencent';

export async function cronCredential(env: Bindings): Promise<string> {
    if (env.CRON_TOKEN) return env.CRON_TOKEN;
    const dao = await ensureDao(env);
    const stored = await dao.getConf('CRON_TOKEN');
    if (stored) return stored;
    const legacy = (await readTriggers(env)).find((entry) => entry.name === 'scheduled');
    const value = legacy?.token || newToken(40);
    await dao.upsertConf('CRON_TOKEN', value, Date.now());
    return value;
}

async function handleCron(c: Context<{Bindings: Bindings}>) {
    const expected = await cronCredential(c.env);
    const provided = c.req.header('X-Trigger-Token') || c.req.query('token') || '';
    if (!provided || await sha256Hex(provided) !== await sha256Hex(expected)) return c.json({ok: false, error: 'Unauthorized'}, 401);
    if (c.req.param('name') && c.req.param('name') !== 'scheduled') return c.json({ok: false}, 404);
    try {
        await runScheduled(c.env);
        return c.json({ok: true, status: 'ok'});
    } catch { return c.json({ok: false, status: 'fail', error: 'Background maintenance failed; inspect administrator logs'}, 500); }
}

export function mountAutomationRoutes(app: Hono<{Bindings: Bindings}>) {
    app.on(['GET', 'POST'], '/cron', handleCron);
    app.on(['GET', 'POST'], '/trigger/:name', handleCron);
    app.use('/admin/automation', adminMiddleware);
    app.use('/admin/automation/*', adminMiddleware);
    app.get('/admin/automation', async (c) => {
        const token = await cronCredential(c.env);
        const origin = new URL(c.req.url).origin;
        return c.json({flags: 0, endpoint: {url: `${origin}/cron?token=${encodeURIComponent(token)}`},
            log: (await readLog(c.env)).slice(0, 60)});
    });
    app.get('/admin/automation/log', async (c) => c.json({flags: 0, items: await readLog(c.env)}));
    app.all('/admin/automation/*', (c) => c.json({flags: 9, texts: '此操作已移除，请使用部署目标；后台维护不需要手动配置'}, 410));
}
