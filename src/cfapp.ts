import {serveStatic} from 'hono/cloudflare-workers' // @ts-ignore
import manifest from '__STATIC_CONTENT_MANIFEST'
import * as index from './index'

// SPA fallback: 尝试访问请求路径对应的静态文件，失败后回退到 index.html
index.app.use("*", serveStatic({manifest: manifest, root: "./"}));
index.app.get("*", serveStatic({
    manifest: manifest,
    root: "./",
    path: "index.html",
} as any));
// export default index.app
index.app.fire()

// 定时任务 ############################################################################################################
export default {
    async fetch(request: Request, env: index.Bindings, ctx: ExecutionContext) {
        return index.app.fetch(request, env, ctx);
    },
    async scheduled(controller: ScheduledController, env: index.Bindings, ctx: ExecutionContext) {
        console.log('Cron job processed', controller.cron);
        try {
            // 免费套餐每个账号仅允许 5 个 cron 触发器，若本 Worker 未占用配额，
            // 可改用 /trigger/:name 端点由外部调度器驱动（见 src/automation.ts）。
            const {runScheduled} = await import('./automation');
            await runScheduled(env);
        } catch (error) {
            console.error('Error processing cron job:', error);
        }
    },
};