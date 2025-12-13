import { Client, Connection } from '@temporalio/client';
import { collectEventsWorkflow, progressQuery, stopCollectionSignal } from './workflows';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('temporal-client');

let client: Client | null = null;

/**
 * Get or create Temporal client
 */
export async function getTemporalClient(): Promise<Client> {
  if (!client) {
    logger.info({ address: config.temporal.address }, 'Connecting to Temporal');
    
    const connection = await Connection.connect({
      address: config.temporal.address,
    });
    
    client = new Client({
      connection,
      namespace: config.temporal.namespace,
    });
  }
  
  return client;
}

/**
 * Start the event collection workflow
 */
export async function startCollectionWorkflow(workflowId?: string): Promise<string> {
  const temporalClient = await getTemporalClient();
  
  const id = workflowId || `collect-events-${Date.now()}`;
  
  logger.info({ workflowId: id }, 'Starting collection workflow');
  
  const handle = await temporalClient.workflow.start(collectEventsWorkflow, {
    taskQueue: config.temporal.taskQueue,
    workflowId: id,
    args: [{
      targetEvents: config.target.minEvents,
      blockBatchSize: config.collection.blockBatchSize,
    }],
  });
  
  return handle.workflowId;
}

/**
 * Get workflow progress
 */
export async function getWorkflowProgress(workflowId: string) {
  const temporalClient = await getTemporalClient();
  const handle = temporalClient.workflow.getHandle(workflowId);
  
  return handle.query(progressQuery);
}

/**
 * Stop workflow gracefully
 */
export async function stopWorkflow(workflowId: string): Promise<void> {
  const temporalClient = await getTemporalClient();
  const handle = temporalClient.workflow.getHandle(workflowId);
  
  await handle.signal(stopCollectionSignal);
  logger.info({ workflowId }, 'Stop signal sent to workflow');
}

/**
 * Wait for workflow completion
 */
export async function waitForWorkflow(workflowId: string) {
  const temporalClient = await getTemporalClient();
  const handle = temporalClient.workflow.getHandle(workflowId);
  
  return handle.result();
}
