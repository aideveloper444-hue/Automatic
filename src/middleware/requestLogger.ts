import { NextFunction, Request, Response } from 'express';
import { appLogger } from '../config/logger.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    appLogger.info('HTTP request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });

  next();
}
