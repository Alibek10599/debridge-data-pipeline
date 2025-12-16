import { Connection, Client } from '@temporalio/client';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('workflow-starter');

/**
 * Start the data collection workflow via Temporal
 */
async function startWorkflow() {
  logger.info('Connecting to Temporal server...');

  const connection = await Connection.connect({
    address: config.temporal.address,
  });

  const client = new Client({
    connection,
    namespace: config.temporal.namespace,
  });

  logger.info('Starting collectEventsWorkflow...');

  const handle = await client.workflow.start('collectEventsWorkflow', {
    taskQueue: config.temporal.taskQueue,
    workflowId: `collect-events-${Date.now()}`,
    args: [{
      targetEvents: config.collection.minEvents,
      blockBatchSize: config.collection.blockBatchSize,
    }],
  });

  logger.info({
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  }, 'Workflow started');

  logger.info('Waiting for workflow to complete...');

  const result = await handle.result();

  logger.info({
    result,
  }, 'Workflow completed successfully!');

  logger.info('='.repeat(60));
  logger.info('Data collection complete!');
  logger.info({
    eventsCollected: result.eventsCollected,
    blocksProcessed: result.blocksProcessed,
    currentBlock: result.currentBlock,
    isComplete: result.isComplete,
  }, 'Summary');
  logger.info('='.repeat(60));

  process.exit(0);
}

startWorkflow().catch((error) => {
  logger.error({ error }, 'Failed to start workflow');
  process.exit(1);
});
