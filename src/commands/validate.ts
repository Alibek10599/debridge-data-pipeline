import { config } from '../config';
import { getClient, getCurrentBlockNumber } from '../blockchain/client';
import { healthCheck as clickhouseHealth } from '../database/clickhouse';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('validate');

interface ValidationResult {
  component: string;
  status: 'ok' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

async function validateRpcConnection(): Promise<ValidationResult> {
  try {
    const client = getClient();
    const blockNumber = await getCurrentBlockNumber();
    return {
      component: 'Ethereum RPC',
      status: 'ok',
      message: 'Connected successfully',
      details: { currentBlock: blockNumber.toString() },
    };
  } catch (error) {
    return {
      component: 'Ethereum RPC',
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function validateClickHouse(): Promise<ValidationResult> {
  try {
    const isHealthy = await clickhouseHealth();
    if (isHealthy) {
      return {
        component: 'ClickHouse',
        status: 'ok',
        message: 'Connected successfully',
        details: {
          host: config.clickhouse.host,
          database: config.clickhouse.database,
        },
      };
    }
    return {
      component: 'ClickHouse',
      status: 'error',
      message: 'Health check failed',
    };
  } catch (error) {
    return {
      component: 'ClickHouse',
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function validateConfiguration(): ValidationResult {
  try {
    return {
      component: 'Configuration',
      status: 'ok',
      message: 'All required variables present',
      details: {
        targetAddress: config.target.address,
        usdcContract: config.target.usdcContract,
        minEvents: config.target.minEvents,
        blockBatchSize: config.collection.blockBatchSize,
      },
    };
  } catch (error) {
    return {
      component: 'Configuration',
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function runValidation(): Promise<void> {
  logger.info('Starting validation checks...\n');

  const results: ValidationResult[] = [];

  // Configuration check
  results.push(validateConfiguration());

  // RPC check
  results.push(await validateRpcConnection());

  // ClickHouse check
  results.push(await validateClickHouse());

  // Print results
  console.log('\n=== Validation Results ===\n');

  let hasErrors = false;
  for (const result of results) {
    const statusIcon = result.status === 'ok' ? '✅' : '❌';
    console.log(`${statusIcon} ${result.component}: ${result.message}`);
    
    if (result.details) {
      Object.entries(result.details).forEach(([key, value]) => {
        console.log(`   ${key}: ${value}`);
      });
    }
    
    if (result.status === 'error') {
      hasErrors = true;
    }
    console.log();
  }

  if (hasErrors) {
    console.log('❌ Some checks failed. Please fix the issues above before running the pipeline.');
    process.exit(1);
  } else {
    console.log('✅ All checks passed. Ready to run the pipeline!');
    process.exit(0);
  }
}

runValidation().catch((error) => {
  logger.error({ error }, 'Validation failed');
  process.exit(1);
});
