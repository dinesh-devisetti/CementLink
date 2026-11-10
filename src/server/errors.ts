export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}
