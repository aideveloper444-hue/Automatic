import { buildContainer } from '../src/container.js';
import { appLogger } from '../src/config/logger.js';

async function main(): Promise<void> {
  const { prisma, schedulerService } = buildContainer();

  try {
    await prisma.$connect();
    appLogger.info('generate-and-schedule: starting one-shot daily automation run');
    await schedulerService.runDailyAutomation();
    appLogger.info('generate-and-schedule: run completed successfully');
    process.exitCode = 0;
  } catch (error) {
    appLogger.error('generate-and-schedule: run failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
