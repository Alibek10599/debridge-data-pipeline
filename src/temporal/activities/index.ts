import { Context } from '@temporalio/activity';
import { 
  fetchTransferEvents, 
  processEventsBatch, 
  getUniqueBlockNumbers,
} from '../../blockchain/events';
import { getCurrentBlockNumber, getBlocks } from '../../blockchain/client';
import { insertTransferEvents, getLastProcessedBlock, getEventCount } from '../../database/queries';
import { initializeSchema } from '../../database/schema';
import { config } from '../../config';
import { createChildLogger } from '../../utils/logger';

const logger = createChildLogger('activities');

/**
 * Block range using string representation for Temporal serialization
 * bigint cannot be serialized by JSON, so we use strings
 */
export interface BlockRangeInput {
  fromBlock: string;
  toBlock: string;
}

/**
 * Initialize database schema
 */
export async function initializeDatabase(): Promise<void> {
  logger.info('Initializing database schema');
  await initializeSchema();
}

/**
 * Get the starting block for collection
 * Returns string for Temporal serialization
 */
export async function getStartingBlock(): Promise<string> {
  const lastBlock = await getLastProcessedBlock();
  
  if (lastBlock) {
    const nextBlock = lastBlock + 1n;
    logger.info({ lastBlock: lastBlock.toString() }, 'Resuming from last processed block');
    return nextBlock.toString();
  }
  
  // Start from recent historical data (last 30 days)
  // This collects recent USDC transfer events for the target address
  const currentBlock = await getCurrentBlockNumber();
  const blocksPerDay = BigInt(24 * 60 * 60 / 12); // ~7,200 blocks per day (12s block time)
  const startBlock = currentBlock - (blocksPerDay * 30n); // Last 30 days

  logger.info({ startBlock: startBlock.toString() }, 'Starting fresh collection from last 30 days');
  return startBlock.toString();
}

/**
 * Get current network block number
 * Returns string for Temporal serialization
 */
export async function getCurrentBlock(): Promise<string> {
  const block = await getCurrentBlockNumber();
  return block.toString();
}

/**
 * Get current event count in database
 */
export async function getCollectedEventCount(): Promise<number> {
  return getEventCount();
}

/**
 * Fetch and process events for a block range
 * Returns number of events collected
 */
export async function fetchAndStoreEvents(range: BlockRangeInput): Promise<number> {
  const fromBlock = BigInt(range.fromBlock);
  const toBlock = BigInt(range.toBlock);
  
  // Report heartbeat for long-running activities
  Context.current().heartbeat({ fromBlock: range.fromBlock, toBlock: range.toBlock });
  
  logger.info(
    { fromBlock: range.fromBlock, toBlock: range.toBlock },
    'Fetching events for block range'
  );
  
  // Fetch raw logs
  const logs = await fetchTransferEvents(
    fromBlock,
    toBlock,
    config.target.address,
    config.target.usdcContract
  );
  
  if (logs.length === 0) {
    logger.debug({ fromBlock: range.fromBlock, toBlock: range.toBlock }, 'No events in range');
    return 0;
  }
  
  logger.info({ count: logs.length }, 'Found transfer events');
  
  // Get block timestamps
  const blockNumbers = getUniqueBlockNumbers(logs);
  const blocks = await getBlocks(blockNumbers);
  const timestamps = new Map<bigint, number>();
  blocks.forEach((block, num) => {
    timestamps.set(num, Number(block.timestamp));
  });
  
  // Process events (decode + enrich with gas data)
  Context.current().heartbeat({ phase: 'processing', logsCount: logs.length });
  const events = await processEventsBatch(logs, timestamps);
  
  // Store in database
  Context.current().heartbeat({ phase: 'storing', eventsCount: events.length });
  await insertTransferEvents(events);
  
  logger.info({ stored: events.length }, 'Events stored successfully');
  
  return events.length;
}
