import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

// ponytail: factory provider — ConfigService isn't available at import time
export const DB_TOKEN = 'DATABASE_CONNECTION';

export const DatabaseProvider = {
  provide: DB_TOKEN,
  useFactory: () => {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('DATABASE_URL is not set');
    const sql = neon(url);
    return drizzle({ client: sql, schema });
  },
};

export type Database = ReturnType<typeof drizzle<typeof schema>>;
