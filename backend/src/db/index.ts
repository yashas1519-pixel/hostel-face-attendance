import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

// ponytail: factory provider — ConfigService isn't available at import time
export const DB_TOKEN = 'DATABASE_CONNECTION';

// Optimise Neon HTTP connection for serverless:
// - fetch keep-alive reduces TLS handshake overhead on Render
// - pooled endpoint uses Neon's PgBouncer (transaction mode, ~10k connections)
neonConfig.fetchConnectionCache = true;

export const DatabaseProvider = {
  provide: DB_TOKEN,
  useFactory: () => {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('DATABASE_URL is not set');

    // Use pooled connection string if provided, otherwise fall back to direct
    // Set NEON_POOL_URL in env to the pooled endpoint from Neon dashboard
    const poolUrl = process.env['NEON_POOL_URL'] ?? url;
    const sql = neon(poolUrl);
    return drizzle({ client: sql, schema });
  },
};

export { schema };
export type Database = ReturnType<typeof drizzle<typeof schema>>;
