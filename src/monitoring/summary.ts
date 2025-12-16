import { register } from 'prom-client';
import { createChildLogger } from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';
import {
  rpcLatency,
  rateLimitHits,
  retriesTotal,
  eventsCollected,
  blocksProcessed,
} from './metrics';

const logger = createChildLogger('metrics-summary');

interface MetricsSummary {
  rpc_calls: {
    total_calls: number;
    avg_latency_ms: number;
    by_method: Record<string, { count: number; avg_latency_ms: number }>;
  };
  rate_limits: {
    total_hits: number;
  };
  retries: {
    total_attempts: number;
    by_reason: Record<string, number>;
  };
  events: {
    total_collected: number;
  };
  blocks: {
    total_processed: number;
  };
}

/**
 * Extract metrics summary from Prometheus metrics
 */
async function getMetricsSummary(): Promise<MetricsSummary> {
  const summary: MetricsSummary = {
    rpc_calls: {
      total_calls: 0,
      avg_latency_ms: 0,
      by_method: {},
    },
    rate_limits: {
      total_hits: 0,
    },
    retries: {
      total_attempts: 0,
      by_reason: {},
    },
    events: {
      total_collected: 0,
    },
    blocks: {
      total_processed: 0,
    },
  };

  // Parse metrics from Prometheus text format
  const metricsText = await register.metrics();
  const lines = metricsText.split('\n');

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith('#') || line.trim() === '') continue;

    // Parse RPC latency histogram counts and sums
    if (line.includes('debridge_rpc_request_duration_seconds_count{')) {
      const match = line.match(/method="([^"]+)".*?\} (\d+)/);
      if (match) {
        const [, method, count] = match;
        if (!summary.rpc_calls.by_method[method]) {
          summary.rpc_calls.by_method[method] = { count: 0, avg_latency_ms: 0 };
        }
        summary.rpc_calls.by_method[method].count = parseInt(count);
        summary.rpc_calls.total_calls += parseInt(count);
      }
    } else if (line.includes('debridge_rpc_request_duration_seconds_sum{')) {
      const match = line.match(/method="([^"]+)".*?\} ([\d.]+)/);
      if (match) {
        const [, method, sum] = match;
        if (summary.rpc_calls.by_method[method]) {
          const count = summary.rpc_calls.by_method[method].count;
          summary.rpc_calls.by_method[method].avg_latency_ms =
            count > 0 ? (parseFloat(sum) / count) * 1000 : 0;
        }
      }
    }
    // Parse rate limit hits
    else if (line.startsWith('debridge_rate_limit_hits_total')) {
      const match = line.match(/\} ([\d.]+)/);
      if (match) {
        summary.rate_limits.total_hits += parseFloat(match[1]);
      }
    }
    // Parse retries
    else if (line.startsWith('debridge_retries_total{')) {
      const reasonMatch = line.match(/reason="([^"]+)"/);
      const valueMatch = line.match(/\} ([\d.]+)/);
      if (reasonMatch && valueMatch) {
        const reason = reasonMatch[1];
        const value = parseFloat(valueMatch[1]);
        summary.retries.by_reason[reason] = (summary.retries.by_reason[reason] || 0) + value;
        summary.retries.total_attempts += value;
      }
    }
    // Parse events collected
    else if (line.startsWith('debridge_events_collected_total')) {
      const match = line.match(/\} ([\d.]+)/);
      if (match) {
        summary.events.total_collected += parseFloat(match[1]);
      }
    }
    // Parse blocks processed
    else if (line.startsWith('debridge_blocks_processed_total')) {
      const match = line.match(/\} ([\d.]+)/);
      if (match) {
        summary.blocks.total_processed += parseFloat(match[1]);
      }
    }
  }

  // Calculate overall average latency
  let totalSum = 0;
  for (const method of Object.values(summary.rpc_calls.by_method)) {
    totalSum += (method.avg_latency_ms / 1000) * method.count;
  }
  summary.rpc_calls.avg_latency_ms =
    summary.rpc_calls.total_calls > 0 ? (totalSum / summary.rpc_calls.total_calls) * 1000 : 0;

  return summary;
}

/**
 * Log metrics summary to console
 */
export async function logMetricsSummary(): Promise<void> {
  const summary = await getMetricsSummary();

  logger.info('='.repeat(60));
  logger.info('📊 METRICS SUMMARY');
  logger.info('='.repeat(60));

  // RPC Calls
  logger.info('');
  logger.info('🌐 RPC Calls:');
  logger.info(`   Total Calls: ${summary.rpc_calls.total_calls}`);
  logger.info(`   Avg Latency: ${summary.rpc_calls.avg_latency_ms.toFixed(2)}ms`);
  if (Object.keys(summary.rpc_calls.by_method).length > 0) {
    logger.info('   By Method:');
    for (const [method, stats] of Object.entries(summary.rpc_calls.by_method)) {
      logger.info(`     • ${method}: ${stats.count} calls, ${stats.avg_latency_ms.toFixed(2)}ms avg`);
    }
  }

  // Events
  logger.info('');
  logger.info('📦 Events:');
  logger.info(`   Total Collected: ${summary.events.total_collected}`);

  // Blocks
  logger.info('');
  logger.info('⛓️  Blocks:');
  logger.info(`   Total Processed: ${summary.blocks.total_processed}`);

  // Rate Limits
  if (summary.rate_limits.total_hits > 0) {
    logger.info('');
    logger.info('⚠️  Rate Limits:');
    logger.info(`   Total Hits: ${summary.rate_limits.total_hits}`);
  }

  // Retries
  if (summary.retries.total_attempts > 0) {
    logger.info('');
    logger.info('🔄 Retries:');
    logger.info(`   Total Attempts: ${summary.retries.total_attempts}`);
    if (Object.keys(summary.retries.by_reason).length > 0) {
      logger.info('   By Reason:');
      for (const [reason, count] of Object.entries(summary.retries.by_reason)) {
        logger.info(`     • ${reason}: ${count}`);
      }
    }
  }

  logger.info('');
  logger.info('='.repeat(60));
}

/**
 * Export metrics to JSON file
 */
export async function exportMetricsToFile(outputPath: string): Promise<void> {
  try {
    // Get both summary and raw metrics
    const summary = await getMetricsSummary();
    const rawMetrics = await register.metrics();

    const output = {
      timestamp: new Date().toISOString(),
      summary,
      prometheus_format: rawMetrics,
    };

    // Ensure output directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // Write to file
    await fs.writeFile(
      outputPath,
      JSON.stringify(output, null, 2),
      'utf-8'
    );

    logger.info({ outputPath }, 'Metrics exported to file');
  } catch (error) {
    logger.error({ error, outputPath }, 'Failed to export metrics');
    throw error;
  }
}
