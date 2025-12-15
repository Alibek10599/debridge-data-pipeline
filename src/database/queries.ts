import { getClickHouseClient } from './clickhouse';
import { TransferEventWithGas } from '../blockchain/events';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('queries');

/**
 * Insert transfer events batch
 * Uses ReplacingMergeTree for automatic deduplication
 */
export async function insertTransferEvents(
  events: TransferEventWithGas[]
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  
  const client = getClickHouseClient();
  
  const rows = events.map(event => {
    // Format timestamp as YYYY-MM-DD HH:MM:SS for ClickHouse DateTime
    const date = new Date(event.blockTimestamp * 1000);
    const timestamp = date.toISOString().slice(0, 19).replace('T', ' ');

    return {
      transaction_hash: event.transactionHash,
      log_index: event.logIndex,
      block_number: Number(event.blockNumber),
      block_timestamp: timestamp,
      from_address: event.from.toLowerCase(),
      to_address: event.to.toLowerCase(),
      value: event.value.toString(),
      gas_used: Number(event.gasUsed),
      effective_gas_price: event.effectiveGasPrice.toString(),
      gas_cost: event.gasCost.toString(),
    };
  });
  
  await client.insert({
    table: 'transfer_events',
    values: rows,
    format: 'JSONEachRow',
  });
  
  logger.info({ count: events.length }, 'Inserted transfer events');
}

/**
 * Get total event count
 */
export async function getEventCount(): Promise<number> {
  const client = getClickHouseClient();
  
  const result = await client.query({
    query: 'SELECT count() as count FROM transfer_events',
    format: 'JSONEachRow',
  });
  
  const data = await result.json<{ count: string }>();
  return parseInt(data[0]?.count || '0', 10);
}

/**
 * Get block range of stored events
 */
export async function getBlockRange(): Promise<{ min: bigint; max: bigint } | null> {
  const client = getClickHouseClient();
  
  const result = await client.query({
    query: `
      SELECT 
        min(block_number) as min_block,
        max(block_number) as max_block
      FROM transfer_events
    `,
    format: 'JSONEachRow',
  });
  
  const data = await result.json<{ min_block: string; max_block: string }>();
  
  if (!data[0]?.min_block) {
    return null;
  }
  
  return {
    min: BigInt(data[0].min_block),
    max: BigInt(data[0].max_block),
  };
}

/**
 * Get date range of stored events
 */
export async function getDateRange(): Promise<{ start: string; end: string } | null> {
  const client = getClickHouseClient();
  
  const result = await client.query({
    query: `
      SELECT 
        formatDateTime(min(block_timestamp), '%Y-%m-%d') as start_date,
        formatDateTime(max(block_timestamp), '%Y-%m-%d') as end_date
      FROM transfer_events
    `,
    format: 'JSONEachRow',
  });
  
  const data = await result.json<{ start_date: string; end_date: string }>();
  
  if (!data[0]?.start_date) {
    return null;
  }
  
  return {
    start: data[0].start_date,
    end: data[0].end_date,
  };
}

/**
 * Get daily gas cost aggregation
 */
export async function getDailyGasCost(): Promise<Array<{
  date: string;
  gas_cost_wei: string;
  gas_cost_eth: number;
}>> {
  const client = getClickHouseClient();
  
  const result = await client.query({
    query: `
      SELECT 
        formatDateTime(event_date, '%Y-%m-%d') as date,
        sum(gas_cost) as gas_cost_wei,
        sum(gas_cost) / 1e18 as gas_cost_eth
      FROM transfer_events
      GROUP BY event_date
      ORDER BY event_date
    `,
    format: 'JSONEachRow',
  });
  
  return result.json();
}

/**
 * Calculate 7-day moving average of effective gas price
 * Uses SQL window functions for efficient calculation
 */
export async function getMA7EffectiveGasPrice(): Promise<Array<{
  date: string;
  ma7_wei: string;
  ma7_gwei: number;
}>> {
  const client = getClickHouseClient();
  
  const result = await client.query({
    query: `
      WITH daily_avg AS (
        SELECT 
          event_date,
          avg(effective_gas_price) as avg_gas_price
        FROM transfer_events
        GROUP BY event_date
        ORDER BY event_date
      )
      SELECT 
        formatDateTime(event_date, '%Y-%m-%d') as date,
        toString(toUInt256(
          avgIf(avg_gas_price, event_date >= subtractDays(da.event_date, 6))
          OVER (ORDER BY event_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
        )) as ma7_wei,
        avg(avg_gas_price) OVER (ORDER BY event_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) / 1e9 as ma7_gwei
      FROM daily_avg da
      ORDER BY event_date
    `,
    format: 'JSONEachRow',
  });
  
  return result.json();
}

/**
 * Calculate cumulative gas cost over time
 */
export async function getCumulativeGasCost(): Promise<Array<{
  date: string;
  cum_eth: number;
}>> {
  const client = getClickHouseClient();
  
  const result = await client.query({
    query: `
      WITH daily_costs AS (
        SELECT 
          event_date,
          sum(gas_cost) as daily_cost
        FROM transfer_events
        GROUP BY event_date
        ORDER BY event_date
      )
      SELECT 
        formatDateTime(event_date, '%Y-%m-%d') as date,
        sum(daily_cost) OVER (ORDER BY event_date) / 1e18 as cum_eth
      FROM daily_costs
      ORDER BY event_date
    `,
    format: 'JSONEachRow',
  });
  
  return result.json();
}

/**
 * Get last processed block for resumable collection
 */
export async function getLastProcessedBlock(): Promise<bigint | null> {
  const client = getClickHouseClient();
  
  const result = await client.query({
    query: 'SELECT max(block_number) as last_block FROM transfer_events',
    format: 'JSONEachRow',
  });
  
  const data = await result.json<{ last_block: string }>();
  
  if (!data[0]?.last_block || data[0].last_block === '0') {
    return null;
  }
  
  return BigInt(data[0].last_block);
}

/**
 * Check if specific event exists (for idempotency)
 */
export async function eventExists(
  transactionHash: string,
  logIndex: number
): Promise<boolean> {
  const client = getClickHouseClient();
  
  const result = await client.query({
    query: `
      SELECT 1 FROM transfer_events 
      WHERE transaction_hash = {txHash:String} 
        AND log_index = {logIndex:UInt32}
      LIMIT 1
    `,
    query_params: {
      txHash: transactionHash,
      logIndex: logIndex,
    },
    format: 'JSONEachRow',
  });
  
  const data = await result.json();
  return data.length > 0;
}
