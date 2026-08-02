import { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors.js';
import { appLogger } from '../config/logger.js';
import { sendError } from '../utils/response.js';

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  const message = err instanceof Error ? err.message : 'Unknown error';
  const statusCode = err instanceof AppError ? err.statusCode : 500;

  appLogger.error('Unhandled request error', {
    path: req.originalUrl,
    method: req.method,
    error: message,
  });

  sendError(res, statusCode, message);
}
