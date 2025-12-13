import { createChildLogger } from './utils/logger';
import { config } from './config';

const logger = createChildLogger('main');

async function main() {
  logger.info({
    targetAddress: config.target.address,
    usdcContract: config.target.usdcContract,
    minEvents: config.target.minEvents,
  }, 'deBridge Data Pipeline initialized');
  
  logger.info(`
Usage:
  npm run pipeline     - Run standalone pipeline (no Temporal)
  npm run dev:worker   - Start Temporal worker
  npm run collect      - Start collection via Temporal
  npm run export       - Export analysis report to JSON
  
For more information, see README.md
  `);
}

main().catch(error => {
  logger.error({ error }, 'Application error');
  process.exit(1);
});
