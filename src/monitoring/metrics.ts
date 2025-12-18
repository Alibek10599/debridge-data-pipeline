import { Counter, Histogram, Gauge, register, collectDefaultMetrics } from 'prom-client';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('metrics');

/**
 * Prometheus metrics for monitoring the data pipeline
 */

// Enable default metrics (CPU, memory, event loop lag, etc.)
collectDefaultMetrics({ prefix: 'debridge_' });

// RPC Request Latency
export const rpcLatency = new Histogram({
  name: 'debridge_rpc_request_duration_seconds',
  help: 'Duration of RPC requests in seconds',
  labelNames: ['method', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30], // seconds
});

// Rate Limit Hits
export const rateLimitHits = new Counter({
  name: 'debridge_rate_limit_hits_total',
  help: 'Total number of rate limit errors encountered',
  labelNames: ['provider'],
});

// Retry Attempts
export const retriesTotal = new Counter({
  name: 'debridge_retries_total',
  help: 'Total number of retry attempts',
  labelNames: ['reason', 'success'],
});

// Events Collected
export const eventsCollected = new Counter({
  name: 'debridge_events_collected_total',
  help: 'Total number of transfer events collected',
});

// Blocks Processed
export const blocksProcessed = new Counter({
  name: 'debridge_blocks_processed_total',
  help: 'Total number of blocks processed',
});

// Database Operations
export const dbOperations = new Counter({
  name: 'debridge_db_operations_total',
  help: 'Total number of database operations',
  labelNames: ['operation', 'status'],
});

export const dbLatency = new Histogram({
  name: 'debridge_db_operation_duration_seconds',
  help: 'Duration of database operations in seconds',
  labelNames: ['operation'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

// Current Pipeline Progress
export const pipelineProgress = new Gauge({
  name: 'debridge_pipeline_progress',
  help: 'Current pipeline progress (events collected / target)',
});

export const currentBlockNumber = new Gauge({
  name: 'debridge_current_block_number',
  help: 'Current block number being processed',
});

/**
 * Utility to time an async operation and record metrics
 */
export async function timeOperation<T>(
  histogram: Histogram,
  labels: Record<string, string>,
  fn: () => Promise<T>
): Promise<T> {
  const end = histogram.startTimer(labels);
  try {
    const result = await fn();
    end();
    return result;
  } catch (error) {
    end();
    throw error;
  }
}

/**
 * Get all metrics in Prometheus format
 */
export async function getMetrics(): Promise<string> {
  return register.metrics();
}

/**
 * Get metrics content type
 */
export function getContentType(): string {
  return register.contentType;
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
  register.resetMetrics();
  logger.info('Metrics reset');
}

