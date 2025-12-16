import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';
import { createMetricsServer } from '../monitoring/server';

const logger = createChildLogger('worker');

async function run() {
  logger.info({ address: config.temporal.address }, 'Starting Temporal worker');

  // Start metrics server for long-running worker
  const metricsServer = createMetricsServer();
  logger.info('Metrics server started for worker');

  // Connect to Temporal server
  const connection = await NativeConnection.connect({
    address: config.temporal.address,
  });
  
  // Create worker
  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.taskQueue,
    workflowsPath: require.resolve('./workflows'),
    activities,
    maxConcurrentActivityTaskExecutions: 10,
    maxConcurrentWorkflowTaskExecutions: 5,
  });
  
  logger.info({ taskQueue: config.temporal.taskQueue }, 'Worker created, starting...');
  
  // Handle shutdown gracefully
  const shutdown = async () => {
    logger.info('Shutting down worker...');
    await worker.shutdown();
    metricsServer.close(() => {
      logger.info('Metrics server closed');
    });
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  // Run worker
  await worker.run();
}

run().catch((error) => {
  logger.error({ error }, 'Worker failed');
  process.exit(1);
});
