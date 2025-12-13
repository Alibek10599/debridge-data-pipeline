import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  sleep,
  continueAsNew,
} from '@temporalio/workflow';
import type * as activities from '../activities';

// Proxy activities with appropriate timeouts and retry policies
const {
  initializeDatabase,
  getStartingBlock,
  getCurrentBlock,
  getCollectedEventCount,
  fetchAndStoreEvents,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '2 minutes',
  retry: {
    initialInterval: '1 second',
    maximumInterval: '1 minute',
    backoffCoefficient: 2,
    maximumAttempts: 5,
    nonRetryableErrorTypes: ['InvalidArgument', 'ConfigurationError'],
  },
});

// Workflow signals and queries
export const stopCollectionSignal = defineSignal('stopCollection');
export const progressQuery = defineQuery<CollectionProgress>('progress');

export interface CollectionProgress {
  eventsCollected: number;
  blocksProcessed: number;
  currentBlock: string;
  targetEvents: number;
  isComplete: boolean;
}

export interface CollectEventsInput {
  targetEvents: number;
  blockBatchSize: number;
  startFromBlock?: string;
}

/**
 * Main workflow for collecting USDC transfer events
 * Supports resumability and graceful stopping
 */
export async function collectEventsWorkflow(input: CollectEventsInput): Promise<CollectionProgress> {
  const { targetEvents, blockBatchSize } = input;
  
  let stopRequested = false;
  let progress: CollectionProgress = {
    eventsCollected: 0,
    blocksProcessed: 0,
    currentBlock: '0',
    targetEvents,
    isComplete: false,
  };
  
  // Set up signal handlers
  setHandler(stopCollectionSignal, () => {
    stopRequested = true;
  });
  
  setHandler(progressQuery, () => progress);
  
  // Initialize database schema
  await initializeDatabase();
  
  // Determine starting point (activities return strings for serialization)
  const startBlockStr = input.startFromBlock || await getStartingBlock();
  const currentNetworkBlockStr = await getCurrentBlock();
  
  // Get current count (for resumable collection)
  progress.eventsCollected = await getCollectedEventCount();
  progress.currentBlock = startBlockStr;
  
  // Parse block numbers for comparison (use string math to avoid BigInt in workflow)
  let currentBlockNum = BigInt(startBlockStr);
  const networkBlockNum = BigInt(currentNetworkBlockStr);
  
  // Main collection loop
  while (
    progress.eventsCollected < targetEvents && 
    currentBlockNum < networkBlockNum &&
    !stopRequested
  ) {
    // Calculate batch end block
    const batchEndNum = currentBlockNum + BigInt(blockBatchSize);
    const endBlockNum = batchEndNum > networkBlockNum ? networkBlockNum : batchEndNum;
    
    // Fetch and store events (pass strings for serialization)
    const eventsFound = await fetchAndStoreEvents({
      fromBlock: currentBlockNum.toString(),
      toBlock: endBlockNum.toString(),
    });
    
    // Update progress
    progress.eventsCollected += eventsFound;
    progress.blocksProcessed += Number(endBlockNum - currentBlockNum + 1n);
    progress.currentBlock = endBlockNum.toString();
    currentBlockNum = endBlockNum + 1n;
    
    // Continue-as-new if we've processed many batches (avoid history size limits)
    if (progress.blocksProcessed > 500000) {
      await continueAsNew<typeof collectEventsWorkflow>({
        ...input,
        startFromBlock: currentBlockNum.toString(),
      });
    }
    
    // Small delay between batches to respect rate limits
    await sleep('500 milliseconds');
  }
  
  progress.isComplete = progress.eventsCollected >= targetEvents || currentBlockNum >= networkBlockNum;
  
  return progress;
}
