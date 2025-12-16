import path from 'path';
import { config } from '../config';
import { initializeSchema } from '../database/schema';
import {
  insertTransferEvents,
  getEventCount,
  getLastProcessedBlock,
  getBlockRange,
  getDateRange
} from '../database/queries';
import { closeClickHouse } from '../database/clickhouse';
import {
  fetchTransferEvents,
  processEventsBatch,
  getUniqueBlockNumbers
} from '../blockchain/events';
import { getCurrentBlockNumber, getBlocks } from '../blockchain/client';
import { exportReportToJson } from '../analysis/metrics';
import { createChildLogger } from '../utils/logger';
import { pipelineProgress, currentBlockNumber, blocksProcessed } from '../monitoring/metrics';
import { logMetricsSummary, exportMetricsToFile } from '../monitoring/summary';

const logger = createChildLogger('pipeline');

/**
 * Standalone pipeline execution without Temporal
 * Useful for local testing and simpler deployments
 */
async function runPipeline() {
  const startTime = Date.now();

  try {
    logger.info('='.repeat(60));
    logger.info('Starting USDC Transfer Events Pipeline');
    logger.info('='.repeat(60));
    
    // Step 1: Initialize database
    logger.info('Step 1: Initializing database schema...');
    await initializeSchema();
    
    // Step 2: Determine block range
    logger.info('Step 2: Determining block range...');
    const currentBlock = await getCurrentBlockNumber();
    let startBlock: bigint;
    
    const lastProcessed = await getLastProcessedBlock();
    if (lastProcessed) {
      startBlock = lastProcessed + 1n;
      logger.info({ lastBlock: lastProcessed.toString() }, 'Resuming from last processed block');
    } else {
      // Start from ~2 years back for comprehensive coverage
      const blocksPerYear = BigInt(365 * 24 * 60 * 60 / 12);
      startBlock = currentBlock - (blocksPerYear * 2n);
      logger.info({ startBlock: startBlock.toString() }, 'Starting fresh collection');
    }
    
    // Step 3: Collect events
    logger.info('Step 3: Collecting transfer events...');
    
    let totalEvents = await getEventCount();
    const targetEvents = config.target.minEvents;
    let currentBlockNum = startBlock;
    const batchSize = BigInt(config.collection.blockBatchSize);
    
    while (totalEvents < targetEvents && currentBlockNum < currentBlock) {
      const endBlock = currentBlockNum + batchSize;
      const rangeEnd = endBlock > currentBlock ? currentBlock : endBlock;

      // Update metrics
      currentBlockNumber.set(Number(currentBlockNum));
      pipelineProgress.set(totalEvents / targetEvents);

      logger.info({
        fromBlock: currentBlockNum.toString(),
        toBlock: rangeEnd.toString(),
        progress: `${totalEvents}/${targetEvents} events`,
      }, 'Processing block range');
      
      // Fetch logs
      const logs = await fetchTransferEvents(
        currentBlockNum,
        rangeEnd,
        config.target.address,
        config.target.usdcContract
      );
      
      if (logs.length > 0) {
        // Get block timestamps
        const blockNumbers = getUniqueBlockNumbers(logs);
        const blocks = await getBlocks(blockNumbers);
        const timestamps = new Map<bigint, number>();
        blocks.forEach((block, num) => {
          timestamps.set(num, Number(block.timestamp));
        });
        
        // Process and store events
        const events = await processEventsBatch(logs, timestamps);
        await insertTransferEvents(events);
        
        totalEvents += events.length;
        logger.info({ newEvents: events.length, totalEvents }, 'Events stored');
      }
      
      currentBlockNum = rangeEnd + 1n;

      // Track blocks processed
      blocksProcessed.inc(Number(rangeEnd - (currentBlockNum - batchSize - 1n)));

      // BALANCED MODE: Moderate delay
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    logger.info({ totalEvents }, 'Event collection completed');
    
    // Step 4: Generate and export report
    logger.info('Step 4: Generating analysis report...');
    const outputPath = path.join(process.cwd(), 'output', 'analysis_report.json');
    await exportReportToJson(outputPath);
    
    // Final summary
    const blockRange = await getBlockRange();
    const dateRange = await getDateRange();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    logger.info('='.repeat(60));
    logger.info('Pipeline completed successfully!');
    logger.info({
      eventsCollected: totalEvents,
      blocksScanned: blockRange ? `${blockRange.min}-${blockRange.max}` : 'N/A',
      period: dateRange ? `${dateRange.start} to ${dateRange.end}` : 'N/A',
      duration: `${duration}s`,
      outputFile: outputPath,
    }, 'Summary');
    logger.info('='.repeat(60));

    // Step 5: Display and export metrics
    logger.info('Step 5: Generating metrics summary...');
    await logMetricsSummary();

    const metricsPath = path.join(process.cwd(), 'output', 'metrics.json');
    await exportMetricsToFile(metricsPath);
    logger.info({ metricsFile: metricsPath }, 'Metrics exported');

  } catch (error) {
    logger.error({ error }, 'Pipeline failed');
    throw error;
  } finally {
    await closeClickHouse();
  }
}

// Run pipeline
runPipeline()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
