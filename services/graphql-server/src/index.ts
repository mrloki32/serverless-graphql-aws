import { createPool, logger } from '@gqlapp/core';
import { loadConfig } from './config';
import { createServer } from './server';

async function main(): Promise<void> {
  process.env.SERVICE_NAME ??= 'graphql-server';
  const config = loadConfig();

  const pool = createPool({
    ...config.db,
    max: 10,
    applicationName: 'graphql-server',
  });

  const { httpServer, apollo } = await createServer({
    pool,
    internalToken: config.internalToken,
    introspection: !config.production,
  });

  httpServer.listen(config.port, () => logger.info('GraphQL server listening', { port: config.port }));

  // ECS sends SIGTERM on scale-in / deployments: stop accepting, drain in-flight
  // requests (the ALB deregistration delay covers the rest), then close the pool.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    try {
      await apollo.stop();
      await pool.end();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: Error) => {
  logger.error('Fatal startup error', { error: err.message });
  process.exit(1);
});
