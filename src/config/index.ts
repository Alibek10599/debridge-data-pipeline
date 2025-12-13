import dotenv from 'dotenv';
import { Address, isAddress } from 'viem';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function requireAddress(key: string): Address {
  const value = requireEnv(key);
  if (!isAddress(value)) {
    throw new Error(`Invalid Ethereum address for ${key}: ${value}`);
  }
  return value as Address;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function optionalInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
}

export const config = {
  // Ethereum RPC
  rpc: {
    url: requireEnv('ETH_RPC_URL'),
  },

  // Target addresses
  target: {
    address: requireAddress('TARGET_ADDRESS'),
    usdcContract: requireAddress('USDC_CONTRACT'),
    minEvents: optionalInt('MIN_EVENTS', 5000),
  },

  // ClickHouse
  clickhouse: {
    host: optionalEnv('CLICKHOUSE_HOST', 'localhost'),
    port: optionalInt('CLICKHOUSE_PORT', 8123),
    database: optionalEnv('CLICKHOUSE_DATABASE', 'debridge'),
    user: optionalEnv('CLICKHOUSE_USER', 'default'),
    password: optionalEnv('CLICKHOUSE_PASSWORD', ''),
  },

  // Temporal
  temporal: {
    address: optionalEnv('TEMPORAL_ADDRESS', 'localhost:7233'),
    namespace: optionalEnv('TEMPORAL_NAMESPACE', 'default'),
    taskQueue: optionalEnv('TEMPORAL_TASK_QUEUE', 'debridge-pipeline'),
  },

  // Collection settings
  collection: {
    blockBatchSize: optionalInt('BLOCK_BATCH_SIZE', 2000),
    maxRetries: optionalInt('MAX_RETRIES', 5),
    initialRetryDelayMs: optionalInt('INITIAL_RETRY_DELAY_MS', 1000),
    maxRetryDelayMs: optionalInt('MAX_RETRY_DELAY_MS', 30000),
  },

  // Logging
  logging: {
    level: optionalEnv('LOG_LEVEL', 'info'),
  },
} as const;

export type Config = typeof config;
