import { exportReportToJson } from '../analysis';
import { createChildLogger } from '../utils/logger';
import path from 'path';

const logger = createChildLogger('export-report');

async function main() {
  try {
    const outputPath = path.join(process.cwd(), 'output', 'analysis_report.json');
    logger.info({ path: outputPath }, 'Exporting analysis report...');

    await exportReportToJson(outputPath);

    logger.info('✓ Report exported successfully!');
    logger.info({ path: outputPath }, 'Report location');

    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Failed to export report');
    process.exit(1);
  }
}

main();
