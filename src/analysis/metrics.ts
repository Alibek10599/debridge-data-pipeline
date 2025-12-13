import {
  getDailyGasCost,
  getMA7EffectiveGasPrice,
  getCumulativeGasCost,
  getEventCount,
  getBlockRange,
  getDateRange,
} from '../database/queries';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('analysis');

export interface AnalysisReport {
  address: string;
  network: string;
  token: string;
  summary: {
    events_collected: number;
    blocks_scanned: [number, number];
    period_utc: [string, string];
  };
  daily_gas_cost: Array<{
    date: string;
    gas_cost_wei: string;
    gas_cost_eth: number;
  }>;
  ma7_effective_gas_price: Array<{
    date: string;
    ma7_wei: string;
    ma7_gwei: number;
  }>;
  cumulative_gas_cost_eth: Array<{
    date: string;
    cum_eth: number;
  }>;
}

/**
 * Generate complete analysis report
 */
export async function generateAnalysisReport(): Promise<AnalysisReport> {
  logger.info('Generating analysis report...');
  
  // Fetch all metrics in parallel
  const [
    eventCount,
    blockRange,
    dateRange,
    dailyGasCost,
    ma7GasPrice,
    cumulativeGasCost,
  ] = await Promise.all([
    getEventCount(),
    getBlockRange(),
    getDateRange(),
    getDailyGasCost(),
    getMA7EffectiveGasPrice(),
    getCumulativeGasCost(),
  ]);
  
  if (!blockRange || !dateRange) {
    throw new Error('No data available for analysis');
  }
  
  const report: AnalysisReport = {
    address: config.target.address.toLowerCase(),
    network: 'ethereum-mainnet',
    token: 'USDC',
    summary: {
      events_collected: eventCount,
      blocks_scanned: [Number(blockRange.min), Number(blockRange.max)],
      period_utc: [dateRange.start, dateRange.end],
    },
    daily_gas_cost: dailyGasCost,
    ma7_effective_gas_price: ma7GasPrice,
    cumulative_gas_cost_eth: cumulativeGasCost,
  };
  
  logger.info(
    { 
      events: eventCount, 
      blocks: `${blockRange.min}-${blockRange.max}`,
      period: `${dateRange.start} to ${dateRange.end}`,
    },
    'Analysis report generated'
  );
  
  return report;
}

/**
 * Export report to JSON file
 */
export async function exportReportToJson(outputPath: string): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const report = await generateAnalysisReport();
  
  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });
  
  // Write formatted JSON
  await fs.writeFile(
    outputPath,
    JSON.stringify(report, null, 2),
    'utf-8'
  );
  
  logger.info({ path: outputPath }, 'Report exported to JSON');
}
