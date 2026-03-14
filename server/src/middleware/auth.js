/**
 * API Key authentication middleware.
 * Validates the X-API-Key header against the configured API_KEY.
 * Requirements: 18.4
 */
export function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_MISSING_KEY',
        message: 'Missing X-API-Key header',
        details: {},
      },
    });
  }

  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_INVALID_KEY',
        message: 'Invalid API key',
        details: {},
      },
    });
  }

  next();
}
