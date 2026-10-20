/**
 * Structured application errors.
 *
 * Every error that can reach the client carries a stable machine-readable code
 * and a message that is safe to display. Provider credentials, request bodies
 * and raw upstream payloads are never attached to client responses.
 */
export class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details = null, expose = true } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = expose;
  }
}

export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, { status: 400, code: 'VALIDATION_ERROR', details });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, { status: 404, code: 'NOT_FOUND' });
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message, details = null) {
    super(message, { status: 409, code: 'CONFLICT', details });
    this.name = 'ConflictError';
  }
}

/**
 * Error raised by the AI provider layer. `httpStatus` maps to a client-facing
 * status code; `providerStatus` is the upstream HTTP status (safe to display).
 */
export class AIError extends AppError {
  constructor(message, { code = 'AI_ERROR', httpStatus = 502, providerStatus = null, details = null } = {}) {
    super(message, { status: httpStatus, code, details });
    this.name = 'AIError';
    this.providerStatus = providerStatus;
  }
}
