import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

// Cache do Next (unstable_cache / revalidateTag do cardápio) guardado no R2.
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
