import { createClient, ClickHouseClient } from '@clickhouse/client';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('clickhouse');

let client: ClickHouseClient | null = null;

/**
 * Get or create ClickHouse client (singleton)
 */
export function getClickHouseClient(): ClickHouseClient {
  if (!client) {
    const url = `http://${config.clickhouse.host}:${config.clickhouse.port}`;
    logger.info(
      { url, database: config.clickhouse.database },
      'Initializing ClickHouse client'
    );
    client = createClient({
      url,
      database: config.clickhouse.database,
      username: config.clickhouse.user,
      password: config.clickhouse.password,
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 1,
      },
    });
  }
  return client;
}

/**
 * Close ClickHouse connection
 */
export async function closeClickHouse(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    logger.info('ClickHouse connection closed');
  }
}

/**
 * Check if ClickHouse is healthy
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const client = getClickHouseClient();
    await client.ping();
    return true;
  } catch (error) {
    logger.error({ error }, 'ClickHouse health check failed');
    return false;
  }
}
