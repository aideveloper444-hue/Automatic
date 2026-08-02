import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { appLogger } from './config/logger.js';
import { buildContainer } from './container.js';
import { buildPostsRouter } from './routes/posts.route.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { sendSuccess } from './utils/response.js';

const container = buildContainer();
const { prisma, postRepository, schedulerService, automationController } = container;

const app = express();
app.use(cors());
app.use(express.json());
app.use(requestLogger);

app.get('/health', (_req, res) => {
  sendSuccess(res, { status: 'ok' }, 'Healthy');
});

app.post('/api/automation/run', async (req, res) => {
  await automationController.triggerRun(req, res);
});

app.use('/api/posts', buildPostsRouter(postRepository));

app.use(notFoundHandler);
app.use(errorHandler);

const port = env.PORT;

async function bootstrap(): Promise<void> {
  try {
    await prisma.$connect();
    appLogger.info('Database connected');

    schedulerService.start();

    const server = app.listen(port, () => {
      appLogger.info(`Server running on port ${port}`);
    });

    const shutdown = async (signal: string): Promise<void> => {
      appLogger.info(`Received ${signal}, shutting down gracefully`);
      server.close();
      await prisma.$disconnect();
      process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    appLogger.error('Failed to start application', { error });
    process.exit(1);
  }
}

bootstrap();
