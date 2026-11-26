export type AppErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'UPSTREAM';

/**
 * Errors that are safe to show to API clients. Anything that is NOT an AppError
 * is treated as an internal failure and masked before it leaves the service.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: AppErrorCode,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED');
  }
}

export class UpstreamError extends AppError {
  constructor(message = 'Upstream service unavailable') {
    super(message, 'UPSTREAM');
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
