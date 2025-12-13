import { createPublicClient, http, PublicClient, Block } from 'viem';
import { mainnet } from 'viem/chains';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('blockchain-client');

let client: PublicClient | null = null;

/**
 * Get or create the Ethereum public client (singleton)
 */
export function getClient(): PublicClient {
  if (!client) {
    logger.info({ rpcUrl: config.rpc.url.substring(0, 30) + '...' }, 'Initializing Ethereum client');
    client = createPublicClient({
      chain: mainnet,
      transport: http(config.rpc.url, {
        retryCount: 0, // We handle retries ourselves
        timeout: 30000,
      }),
    });
  }
  return client;
}

/**
 * Get current block number
 */
export async function getCurrentBlockNumber(): Promise<bigint> {
  const client = getClient();
  return client.getBlockNumber();
}

/**
 * Get block by number with timestamp
 */
export async function getBlock(blockNumber: bigint): Promise<Block> {
  const client = getClient();
  return client.getBlock({ blockNumber });
}

/**
 * Get multiple blocks efficiently
 */
export async function getBlocks(blockNumbers: bigint[]): Promise<Map<bigint, Block>> {
  const client = getClient();
  const blocks = new Map<bigint, Block>();
  
  // Batch requests for efficiency
  const batchSize = 10;
  for (let i = 0; i < blockNumbers.length; i += batchSize) {
    const batch = blockNumbers.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(num => client.getBlock({ blockNumber: num }))
    );
    results.forEach((block, idx) => {
      blocks.set(batch[idx], block);
    });
  }
  
  return blocks;
}

/**
 * Get transaction receipt for gas analysis
 */
export async function getTransactionReceipt(txHash: `0x${string}`) {
  const client = getClient();
  return client.getTransactionReceipt({ hash: txHash });
}

/**
 * Get multiple transaction receipts
 */
export async function getTransactionReceipts(txHashes: `0x${string}`[]) {
  const client = getClient();
  
  // Batch for efficiency
  const batchSize = 20;
  const receipts = [];
  
  for (let i = 0; i < txHashes.length; i += batchSize) {
    const batch = txHashes.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(hash => client.getTransactionReceipt({ hash }))
    );
    receipts.push(...results);
  }
  
  return receipts;
}
