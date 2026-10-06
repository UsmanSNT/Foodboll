import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { createTelegramClient } from './integrations/telegram';
import { startNotificationWorker } from './services/notification-worker';

const config = loadConfig();
const handle = createDb(config.databaseUrl);
const telegram = config.telegram ? createTelegramClient({ token: config.telegram.botToken }) : null;
const app = buildApp(config, handle.db, { telegram });

// Deliver queued Telegram notifications in the background (only if the bot is configured).
const worker = telegram
  ? startNotificationWorker(handle.db, telegram, {
      onError: (error) => app.log.error({ err: error }, 'notification worker failed'),
    })
  : null;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'Shutting down');
    worker?.stop();
    void app.close().then(() => handle.close());
  });
}

await app.listen({ host: config.host, port: config.port });
