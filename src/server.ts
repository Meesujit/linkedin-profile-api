/**
 * Process entry point. Builds the app, starts the server, and wires graceful
 * shutdown so the browser and any in-flight requests are cleaned up.
 */

import { buildApp } from './app.js';
import { config } from './config.js';

const { app, service } = await buildApp();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  await app.close().catch(() => undefined);
  await service.close().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info(`linkedin-profile-api listening at ${address}`);
} catch (err) {
  app.log.error(err, 'failed to start server');
  process.exit(1);
}
