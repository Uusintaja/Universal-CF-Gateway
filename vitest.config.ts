import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    pool: '@cloudflare/vitest-pool-workers',
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.toml'
        },
        miniflare: {
          // Keep compatibility with DESIGN-DOC Env minimal
          kvNamespaces: ['KV'],
          durableObjects: {
            COORDINATOR: 'CoordinatorDO'
          },
          queueConsumers: {
            'test-queue': { maxBatchTimeout: 1 }
          },
          r2Buckets: [],
          bindings: {}
        }
      }
    },
    include: ['test/**/*.spec.ts'],
    globals: false
  }
});
