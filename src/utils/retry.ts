import { createChildLogger } from './logger';

const logger = createChildLogger('retry');

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  retryableErrors?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Calculate delay with exponential backoff and jitter
 * Uses "full jitter" strategy for better distributed retry patterns
 */
function calculateDelay(attempt: number, options: RetryOptions): number {
  const exponentialDelay = options.initialDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);
  // Full jitter: random value between 0 and cappedDelay
  return Math.random() * cappedDelay;
}

/**
 * Check if error is retryable (rate limits, network errors, etc.)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const errorString = JSON.stringify(error).toLowerCase();

    // Rate limit errors
    if (message.includes('rate limit') || message.includes('429')) {
      return true;
    }
    // Network errors
    if (message.includes('econnreset') || message.includes('etimedout') ||
        message.includes('enotfound') || message.includes('network')) {
      return true;
    }
    // Server errors (5xx)
    if (message.includes('500') || message.includes('502') ||
        message.includes('503') || message.includes('504')) {
      return true;
    }
    // Infura: "query returned more than 10000 results" (error -32005)
    // This is NOT retryable - caller should reduce block range
    if (errorString.includes('10000 results') || errorString.includes('-32005')) {
      return false;
    }
    // Alchemy: block range errors (error -32600)
    // This is NOT retryable - caller should reduce block range
    if (errorString.includes('block range') || errorString.includes('-32600')) {
      return false;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute function with exponential backoff retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };
  const isRetryable = opts.retryableErrors || isRetryableError;

  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === opts.maxRetries) {
        logger.error({ error, attempt }, 'Max retries exceeded');
        throw error;
      }

      if (!isRetryable(error)) {
        logger.error({ error }, 'Non-retryable error encountered');
        throw error;
      }

      const delay = calculateDelay(attempt, opts);
      logger.warn(
        { attempt: attempt + 1, maxRetries: opts.maxRetries, delayMs: Math.round(delay) },
        'Retrying after error'
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Create a retry wrapper with pre-configured options
 */
export function createRetryWrapper(options: Partial<RetryOptions>) {
  return <T>(fn: () => Promise<T>) => withRetry(fn, options);
}
