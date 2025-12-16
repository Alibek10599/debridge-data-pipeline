import { Address, Log, parseAbiItem, decodeEventLog, keccak256, toHex } from 'viem';
import { getClient, getBlock, getTransactionReceipt } from './client';
import { config } from '../config';
import { withRetry } from '../utils/retry';
import { createChildLogger } from '../utils/logger';
import { rpcLatency, timeOperation, eventsCollected } from '../monitoring/metrics';

const logger = createChildLogger('events');

// ERC-20 Transfer event ABI
const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

// Transfer event signature hash
const TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'));

export interface TransferEvent {
  transactionHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: number;
  from: Address;
  to: Address;
  value: bigint;
}

export interface TransferEventWithGas extends TransferEvent {
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  gasCost: bigint;
}

/**
 * Fetch transfer events for a block range
 * Filters for events where target address is sender OR recipient
 */
export async function fetchTransferEvents(
  fromBlock: bigint,
  toBlock: bigint,
  targetAddress: Address,
  contractAddress: Address
): Promise<Log[]> {
  return timeOperation(
    rpcLatency,
    { method: 'eth_getLogs', status: 'success' },
    async () => {
      const client = getClient();

      // We need to make two queries: one for 'from' and one for 'to'
      // eth_getLogs with OR on indexed params requires separate calls

      const [logsFrom, logsTo] = await Promise.all([
        // Events where target is sender
        withRetry(() => client.getLogs({
          address: contractAddress,
          event: TRANSFER_EVENT,
          args: { from: targetAddress },
          fromBlock,
          toBlock,
        }), {
          maxRetries: config.collection.maxRetries,
          initialDelayMs: config.collection.initialRetryDelayMs,
          maxDelayMs: config.collection.maxRetryDelayMs,
        }),
        // Events where target is recipient
        withRetry(() => client.getLogs({
          address: contractAddress,
          event: TRANSFER_EVENT,
          args: { to: targetAddress },
          fromBlock,
          toBlock,
        }), {
          maxRetries: config.collection.maxRetries,
          initialDelayMs: config.collection.initialRetryDelayMs,
          maxDelayMs: config.collection.maxRetryDelayMs,
        }),
      ]);

      // Combine and deduplicate (in case of self-transfers)
      const logsMap = new Map<string, Log>();
      [...logsFrom, ...logsTo].forEach(log => {
        const key = `${log.transactionHash}-${log.logIndex}`;
        logsMap.set(key, log);
      });

      const logs = Array.from(logsMap.values());

      // Track events collected
      eventsCollected.inc(logs.length);

      return logs;
    }
  );
}

/**
 * Decode raw log to TransferEvent
 */
export function decodeTransferEvent(log: Log, blockTimestamp: number): TransferEvent {
  const decoded = decodeEventLog({
    abi: [TRANSFER_EVENT],
    data: log.data,
    topics: log.topics,
  });
  
  return {
    transactionHash: log.transactionHash!,
    logIndex: log.logIndex!,
    blockNumber: log.blockNumber!,
    blockTimestamp,
    from: decoded.args.from as Address,
    to: decoded.args.to as Address,
    value: decoded.args.value as bigint,
  };
}

/**
 * Enrich transfer event with gas information from receipt
 */
export async function enrichWithGasData(
  event: TransferEvent
): Promise<TransferEventWithGas> {
  const receipt = await withRetry(
    () => getTransactionReceipt(event.transactionHash),
    {
      maxRetries: config.collection.maxRetries,
      initialDelayMs: config.collection.initialRetryDelayMs,
      maxDelayMs: config.collection.maxRetryDelayMs,
    }
  );
  
  const gasUsed = receipt.gasUsed;
  const effectiveGasPrice = receipt.effectiveGasPrice;
  const gasCost = gasUsed * effectiveGasPrice;
  
  return {
    ...event,
    gasUsed,
    effectiveGasPrice,
    gasCost,
  };
}

/**
 * Process logs batch: decode and enrich with timestamps and gas data
 */
export async function processEventsBatch(
  logs: Log[],
  blockTimestamps: Map<bigint, number>
): Promise<TransferEventWithGas[]> {
  const events: TransferEventWithGas[] = [];
  
  // Process in smaller batches to avoid rate limits
  const batchSize = 50;
  
  for (let i = 0; i < logs.length; i += batchSize) {
    const batch = logs.slice(i, i + batchSize);
    
    const batchResults = await Promise.all(
      batch.map(async (log) => {
        const timestamp = blockTimestamps.get(log.blockNumber!) || 0;
        const event = decodeTransferEvent(log, timestamp);
        return enrichWithGasData(event);
      })
    );
    
    events.push(...batchResults);
    
    if (i + batchSize < logs.length) {
      // Small delay between batches to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return events;
}

/**
 * Get unique block numbers from logs
 */
export function getUniqueBlockNumbers(logs: Log[]): bigint[] {
  const blocks = new Set<bigint>();
  logs.forEach(log => {
    if (log.blockNumber) {
      blocks.add(log.blockNumber);
    }
  });
  return Array.from(blocks).sort((a, b) => Number(a - b));
}
