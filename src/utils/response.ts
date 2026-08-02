import { Response } from 'express';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export function sendSuccess<T>(res: Response, data: T, message = 'Success'): void {
  const payload: ApiResponse<T> = {
    success: true,
    data,
    message,
  };

  res.status(200).json(payload);
}

export function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({
    success: false,
    error: message,
  });
}
