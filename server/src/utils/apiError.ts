export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: unknown): ApiError {
    return new ApiError(400, code, message, details);
  }

  static notFound(message: string, code = 'NOT_FOUND'): ApiError {
    return new ApiError(404, code, message);
  }

  static forbidden(message: string, code = 'FORBIDDEN'): ApiError {
    return new ApiError(403, code, message);
  }

  static conflict(message: string, code = 'CONFLICT'): ApiError {
    return new ApiError(409, code, message);
  }

  static payloadTooLarge(message: string, code = 'PAYLOAD_TOO_LARGE'): ApiError {
    return new ApiError(413, code, message);
  }

  static internal(message: string, code = 'INTERNAL_ERROR', details?: unknown): ApiError {
    return new ApiError(500, code, message, details);
  }
}
