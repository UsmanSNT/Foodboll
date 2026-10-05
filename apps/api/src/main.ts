import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';

const config = loadConfig();
const handle = createDb(config.databaseUrl);
const app = buildApp(config, handle.db);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'Shutting down');
    void app.close().then(() => handle.close());
  });
}

await app.listen({ host: config.host, port: config.port });
