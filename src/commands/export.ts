import path from 'path';
import { exportReportToJson } from '../analysis/metrics';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('export-command');

async function main() {
  try {
    const outputPath = process.argv[2] || path.join(process.cwd(), 'output', 'analysis_report.json');
    
    logger.info({ outputPath }, 'Exporting analysis report...');
    
    await exportReportToJson(outputPath);
    
    logger.info('Export completed successfully');
    
  } catch (error) {
    logger.error({ error }, 'Export failed');
    process.exit(1);
  }
}

main();
