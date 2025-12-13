import { startCollectionWorkflow, waitForWorkflow, getWorkflowProgress } from '../temporal/client';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('collect-command');

async function main() {
  try {
    logger.info('Starting event collection workflow...');
    
    const workflowId = await startCollectionWorkflow();
    logger.info({ workflowId }, 'Workflow started');
    
    // Poll for progress
    const pollInterval = setInterval(async () => {
      try {
        const progress = await getWorkflowProgress(workflowId);
        logger.info(
          {
            eventsCollected: progress.eventsCollected,
            blocksProcessed: progress.blocksProcessed,
            currentBlock: progress.currentBlock,
            targetEvents: progress.targetEvents,
          },
          'Collection progress'
        );
      } catch (error) {
        // Workflow might have completed
      }
    }, 10000);
    
    // Wait for completion
    const result = await waitForWorkflow(workflowId);
    clearInterval(pollInterval);
    
    logger.info({ result }, 'Collection completed');
    
  } catch (error) {
    logger.error({ error }, 'Collection failed');
    process.exit(1);
  }
}

main();
