import { AppError } from './errorHandler.js';

/**
 * Creates a request validation middleware.
 *
 * @param {Object} schema - Validation schema with optional `body`, `params`, and `query` keys.
 *   Each key maps to an object of field rules: { fieldName: { required, type, min, max, oneOf } }
 * @returns Express middleware function
 *
 * Example usage:
 *   validate({
 *     body: {
 *       amount: { required: true, type: 'number', min: 0 },
 *       status: { required: false, type: 'string', oneOf: ['pending', 'paid'] },
 *     },
 *     params: {
 *       id: { required: true, type: 'number' },
 *     },
 *   })
 */
export function validate(schema) {
  return (req, _res, next) => {
    const errors = [];

    for (const source of ['body', 'params', 'query']) {
      const rules = schema[source];
      if (!rules) continue;

      const data = req[source] || {};

      for (const [field, rule] of Object.entries(rules)) {
        const value = data[field];

        // Check required
        if (rule.required && (value === undefined || value === null || value === '')) {
          errors.push({ field: `${source}.${field}`, message: `${field} is required` });
          continue;
        }

        // Skip further checks if value is absent and not required
        if (value === undefined || value === null) continue;

        // Type check
        if (rule.type) {
          const actualType = typeof value;
          if (rule.type === 'number') {
            const num = source === 'params' || source === 'query' ? Number(value) : value;
            if (typeof num !== 'number' || isNaN(num)) {
              errors.push({ field: `${source}.${field}`, message: `${field} must be a number` });
              continue;
            }
          } else if (actualType !== rule.type) {
            errors.push({ field: `${source}.${field}`, message: `${field} must be a ${rule.type}` });
            continue;
          }
        }

        // Numeric range
        const numVal = typeof value === 'string' ? Number(value) : value;
        if (rule.min !== undefined && typeof numVal === 'number' && numVal < rule.min) {
          errors.push({ field: `${source}.${field}`, message: `${field} must be at least ${rule.min}` });
        }
        if (rule.max !== undefined && typeof numVal === 'number' && numVal > rule.max) {
          errors.push({ field: `${source}.${field}`, message: `${field} must be at most ${rule.max}` });
        }

        // Enum check
        if (rule.oneOf && !rule.oneOf.includes(value)) {
          errors.push({
            field: `${source}.${field}`,
            message: `${field} must be one of: ${rule.oneOf.join(', ')}`,
          });
        }
      }
    }

    if (errors.length > 0) {
      return next(new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', { errors }));
    }

    next();
  };
}
