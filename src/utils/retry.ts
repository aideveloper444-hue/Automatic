import { appLogger } from '../config/logger.js';

export interface RetryOptions {
  retries?: number;
  delayMs?: number;
  backoffFactor?: number;
  label?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { retries = 3, delayMs = 500, backoffFactor = 2, label = 'operation' } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);

      if (attempt === retries) {
        appLogger.error(`${label} failed after ${retries} attempts`, { attempt, error: message });
        break;
      }

      const wait = delayMs * Math.pow(backoffFactor, attempt - 1);
      appLogger.warn(`${label} failed, retrying`, {
        attempt,
        retries,
        waitMs: wait,
        error: message,
      });
      await sleep(wait);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} failed after ${retries} attempts`);
}
