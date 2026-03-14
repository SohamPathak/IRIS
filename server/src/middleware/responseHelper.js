/**
 * Attaches `res.success(data, statusCode)` and `res.error(message, statusCode)` helpers.
 * Ensures consistent response envelopes.
 */
export function responseHelper(_req, res, next) {
  res.success = (data, statusCode = 200) => {
    res.status(statusCode).json({
      success: true,
      data,
    });
  };

  res.error = (message, statusCode = 500) => {
    res.status(statusCode).json({
      success: false,
      error: { message },
    });
  };

  next();
}
