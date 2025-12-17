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
  docker compose up -d              - Start all services
  docker compose up starter         - Trigger data collection workflow
  docker compose run starter \\
    node dist/commands/export-report.js  - Export analysis report

Dashboard:
  Grafana: http://localhost:3000
  Prometheus: http://localhost:9092
  Temporal UI: http://localhost:8080

Output:
  ./output/analysis_report.json     - Analysis report
  ./output/dashboard.html           - Interactive dashboard

For more information, see README.md
  `);
}

main().catch(error => {
  logger.error({ error }, 'Application error');
  process.exit(1);
});
