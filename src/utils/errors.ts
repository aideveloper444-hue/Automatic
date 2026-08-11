export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
    public readonly isOperational = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class GeminiServiceError extends AppError {
  constructor(message: string) {
    super(`Gemini service error: ${message}`, 502);
  }
}

export class BufferServiceError extends AppError {
  constructor(message: string) {
    super(`Buffer service error: ${message}`, 502);
  }
}

export class OpenAiServiceError extends AppError {
  constructor(message: string) {
    super(`OpenAI service error: ${message}`, 502);
  }
}

export class GroqServiceError extends AppError {
  constructor(message: string) {
    super(`Groq service error: ${message}`, 502);
  }
}
