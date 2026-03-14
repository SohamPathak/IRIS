/**
 * Application-level error class with HTTP status and error code.
 */
export class AppError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/**
 * Not-found handler for unmatched routes.
 */
export function notFoundHandler(req, res, _next) {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`,
      details: {},
    },
  });
}

/**
 * Global error handling middleware.
 * Produces a consistent JSON envelope: { success, error: { code, message, details } }
 */
export function errorHandler(err, _req, res, _next) {
  // Handle known application errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  // Handle JSON parse errors from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Request body contains invalid JSON',
        details: {},
      },
    });
  }

  // Unexpected errors — log and return generic 500
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      details: {},
    },
  });
}
