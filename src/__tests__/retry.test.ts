import { withRetry, createRetryWrapper } from '../utils/retry';

// Mock the logger
jest.mock('../utils/logger', () => ({
  createChildLogger: () => ({
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('retry utility', () => {
  describe('withRetry', () => {
    it('should return result on first successful attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      
      const result = await withRetry(fn, { maxRetries: 3, initialDelayMs: 10, maxDelayMs: 100 });
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });
    
    it('should retry on retryable errors', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('rate limit exceeded'))
        .mockResolvedValue('success');
      
      const result = await withRetry(fn, { maxRetries: 3, initialDelayMs: 10, maxDelayMs: 100 });
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });
    
    it('should throw on non-retryable errors', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('invalid argument'));
      
      await expect(
        withRetry(fn, { maxRetries: 3, initialDelayMs: 10, maxDelayMs: 100 })
      ).rejects.toThrow('invalid argument');
      
      expect(fn).toHaveBeenCalledTimes(1);
    });
    
    it('should throw after max retries exceeded', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('rate limit'));
      
      await expect(
        withRetry(fn, { maxRetries: 2, initialDelayMs: 10, maxDelayMs: 100 })
      ).rejects.toThrow('rate limit');
      
      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });
  });
  
  describe('createRetryWrapper', () => {
    it('should create a wrapper with preset options', async () => {
      const wrapper = createRetryWrapper({ maxRetries: 1, initialDelayMs: 10, maxDelayMs: 100 });
      const fn = jest.fn().mockResolvedValue('wrapped');
      
      const result = await wrapper(fn);
      
      expect(result).toBe('wrapped');
    });
  });
});
