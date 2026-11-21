// Entrada do Worker na Cloudflare: o app Next (OpenNext) + os crons que antes eram da Vercel.
// @ts-expect-error: gerado por `opennextjs-cloudflare build`
import openNext from "./.open-next/worker.js";

// @ts-expect-error: gerado por `opennextjs-cloudflare build`
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

type Env = { CRON_SECRET?: string; APP_URL?: string; [key: string]: unknown };

const JOBS: Record<string, string[]> = {
  "*/5 * * * *": ["/api/cron/whatsapp-followups"],
  "0 8 * * *": ["/api/cron/expire-orders"],
};

export default {
  fetch: (request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => openNext.fetch(request, env, ctx),

  async scheduled(controller: { cron: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const paths = JOBS[controller.cron] ?? [];
    const base = env.APP_URL;
    if (!base || !env.CRON_SECRET) {
      console.error("[cron] APP_URL ou CRON_SECRET ausente");
      return;
    }
    for (const path of paths) {
      ctx.waitUntil(
        fetch(new URL(path, base), { headers: { authorization: `Bearer ${env.CRON_SECRET}` } })
          .then((res) => console.log(`[cron] ${path} -> ${res.status}`))
          .catch((error) => console.error(`[cron] ${path} falhou`, String(error))),
      );
    }
  },
};
