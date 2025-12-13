import { decodeTransferEvent, getUniqueBlockNumbers } from '../blockchain/events';
import { Log } from 'viem';

// Mock dependencies
jest.mock('../config', () => ({
  config: {
    collection: {
      maxRetries: 3,
      initialRetryDelayMs: 100,
      maxRetryDelayMs: 1000,
    },
  },
}));

jest.mock('../utils/logger', () => ({
  createChildLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('events module', () => {
  describe('decodeTransferEvent', () => {
    it('should decode a valid transfer event log', () => {
      // Real Transfer event data structure
      const mockLog: Log = {
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 18500000n,
        data: '0x0000000000000000000000000000000000000000000000000000000005f5e100', // 100 USDC
        logIndex: 5,
        removed: false,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer signature
          '0x000000000000000000000000ef4fb24ad0916217251f553c0596f8edc630eb66', // from
          '0x0000000000000000000000001234567890123456789012345678901234567890', // to
        ],
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        transactionIndex: 10,
      };

      const timestamp = 1699900000;
      const event = decodeTransferEvent(mockLog, timestamp);

      expect(event.transactionHash).toBe(mockLog.transactionHash);
      expect(event.logIndex).toBe(5);
      expect(event.blockNumber).toBe(18500000n);
      expect(event.blockTimestamp).toBe(timestamp);
      expect(event.from.toLowerCase()).toBe('0xef4fb24ad0916217251f553c0596f8edc630eb66');
      expect(event.value).toBe(100000000n); // 100 USDC in base units
    });
  });

  describe('getUniqueBlockNumbers', () => {
    it('should extract unique block numbers from logs', () => {
      const logs: Partial<Log>[] = [
        { blockNumber: 100n },
        { blockNumber: 100n },
        { blockNumber: 200n },
        { blockNumber: 150n },
        { blockNumber: 200n },
      ];

      const uniqueBlocks = getUniqueBlockNumbers(logs as Log[]);

      expect(uniqueBlocks).toHaveLength(3);
      expect(uniqueBlocks).toEqual([100n, 150n, 200n]); // sorted
    });

    it('should handle empty logs array', () => {
      const uniqueBlocks = getUniqueBlockNumbers([]);
      expect(uniqueBlocks).toHaveLength(0);
    });

    it('should handle logs without block numbers', () => {
      const logs: Partial<Log>[] = [
        { blockNumber: 100n },
        { blockNumber: undefined },
        { blockNumber: 200n },
      ];

      const uniqueBlocks = getUniqueBlockNumbers(logs as Log[]);
      expect(uniqueBlocks).toEqual([100n, 200n]);
    });
  });
});
