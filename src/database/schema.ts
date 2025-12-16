import { getClickHouseClient } from './clickhouse';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('schema');

/**
 * Create database if not exists
 */
export async function createDatabase(): Promise<void> {
  const client = getClickHouseClient();
  
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS ${config.clickhouse.database}`,
  });
  
  logger.info({ database: config.clickhouse.database }, 'Database ensured');
}

/**
 * Create transfer_events table with optimized schema for time-series
 * Uses MergeTree with partitioning by month for efficient queries
 */
export async function createTransferEventsTable(): Promise<void> {
  const client = getClickHouseClient();
  
  const query = `
    CREATE TABLE IF NOT EXISTS transfer_events (
      transaction_hash String,
      log_index UInt32,
      block_number UInt64,
      block_timestamp DateTime,
      from_address String,
      to_address String,
      value UInt256,
      gas_used UInt64,
      effective_gas_price UInt256,
      gas_cost UInt256,
      event_date Date DEFAULT toDate(block_timestamp)
    )
    ENGINE = ReplacingMergeTree()
    PARTITION BY toYYYYMM(event_date)
    ORDER BY (block_timestamp, transaction_hash, log_index)
    SETTINGS index_granularity = 8192
  `;
  
  await client.command({ query });
  logger.info('transfer_events table created/verified');
}


/**
 * Create indexes for efficient querying
 */
export async function createIndexes(): Promise<void> {
  const client = getClickHouseClient();
  
  // Check if indexes exist before creating
  const indexCheck = await client.query({
    query: `
      SELECT name FROM system.data_skipping_indices 
      WHERE table = 'transfer_events' AND database = {db:String}
    `,
    query_params: { db: config.clickhouse.database },
    format: 'JSONEachRow',
  });
  
  const existingIndexes = await indexCheck.json<{ name: string }>();
  const indexNames = new Set(existingIndexes.map(i => i.name));
  
  // Add skip index for address filtering
  try {
    if (!indexNames.has('idx_from_address')) {
      await client.command({
        query: `
          ALTER TABLE transfer_events
          ADD INDEX idx_from_address from_address TYPE bloom_filter() GRANULARITY 4
        `,
      });
      logger.info('Created idx_from_address index');
    }
    
    if (!indexNames.has('idx_to_address')) {
      await client.command({
        query: `
          ALTER TABLE transfer_events
          ADD INDEX idx_to_address to_address TYPE bloom_filter() GRANULARITY 4
        `,
      });
      logger.info('Created idx_to_address index');
    }
    
    logger.info('Indexes verified');
  } catch (error) {
    // Indexes might already exist or table not ready
    logger.debug({ error }, 'Index creation skipped');
  }
}

/**
 * Initialize all database schema
 */
export async function initializeSchema(): Promise<void> {
  logger.info('Initializing database schema...');

  await createDatabase();
  await createTransferEventsTable();
  await createIndexes();

  logger.info('Schema initialization complete');
}
