import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { authenticateApiKey } from '../../../src/middleware/auth.js';
import { errorHandler, notFoundHandler, AppError } from '../../../src/middleware/errorHandler.js';
import { responseHelper } from '../../../src/middleware/responseHelper.js';
import { validate } from '../../../src/middleware/validate.js';

/**
 * Helper: creates a minimal Express app with the full middleware stack for testing.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(responseHelper);
  return app;
}

// ─── Auth Middleware ───

describe('authenticateApiKey', () => {
  const originalApiKey = process.env.API_KEY;

  function buildApp() {
    const app = createTestApp();
    app.use(authenticateApiKey);
    app.get('/test', (req, res) => res.success({ ok: true }));
    app.use(errorHandler);
    return app;
  }

  it('returns 401 when X-API-Key header is missing', async () => {
    process.env.API_KEY = 'iris-dev-key';
    const res = await request(buildApp()).get('/test');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTH_MISSING_KEY');
    process.env.API_KEY = originalApiKey;
  });

  it('returns 401 when X-API-Key is invalid', async () => {
    process.env.API_KEY = 'iris-dev-key';
    const res = await request(buildApp()).get('/test').set('X-API-Key', 'wrong-key');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTH_INVALID_KEY');
    process.env.API_KEY = originalApiKey;
  });

  it('passes through when X-API-Key is valid', async () => {
    process.env.API_KEY = 'iris-dev-key';
    const res = await request(buildApp()).get('/test').set('X-API-Key', 'iris-dev-key');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { ok: true } });
    process.env.API_KEY = originalApiKey;
  });
});

// ─── Error Handler ───

describe('errorHandler', () => {
  it('formats AppError into consistent JSON envelope', async () => {
    const app = createTestApp();
    app.get('/test', (_req, _res, next) => {
      next(new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice with ID 123 not found'));
    });
    app.use(errorHandler);

    const res = await request(app).get('/test');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'INVOICE_NOT_FOUND',
        message: 'Invoice with ID 123 not found',
        details: {},
      },
    });
  });

  it('handles invalid JSON body with 400', async () => {
    const app = createTestApp();
    app.post('/test', (_req, res) => res.success({ ok: true }));
    app.use(errorHandler);

    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send('{ bad json }');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns generic 500 for unexpected errors', async () => {
    const app = createTestApp();
    app.get('/test', () => { throw new Error('kaboom'); });
    app.use(errorHandler);

    const res = await request(app).get('/test');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: {},
      },
    });
  });
});

// ─── Not Found Handler ───

describe('notFoundHandler', () => {
  it('returns 404 for unmatched routes', async () => {
    const app = createTestApp();
    app.use(notFoundHandler);

    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});

// ─── Response Helper ───

describe('responseHelper', () => {
  it('wraps data in success envelope with default 200', async () => {
    const app = createTestApp();
    app.get('/test', (req, res) => res.success({ items: [1, 2, 3] }));

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { items: [1, 2, 3] } });
  });

  it('supports custom status codes', async () => {
    const app = createTestApp();
    app.post('/test', (req, res) => res.success({ id: 42 }, 201));

    const res = await request(app).post('/test');
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: { id: 42 } });
  });
});

// ─── Validate Middleware ───

describe('validate', () => {
  function buildValidationApp(schema) {
    const app = createTestApp();
    app.post('/test/:id?', validate(schema), (req, res) => res.success({ ok: true }));
    app.use(errorHandler);
    return app;
  }

  it('passes when all required fields are present and valid', async () => {
    const app = buildValidationApp({
      body: { amount: { required: true, type: 'number', min: 0 } },
    });
    const res = await request(app).post('/test').send({ amount: 100 });
    expect(res.status).toBe(200);
  });

  it('returns 400 when required field is missing', async () => {
    const app = buildValidationApp({
      body: { amount: { required: true, type: 'number' } },
    });
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.errors).toHaveLength(1);
  });

  it('returns 400 when field type is wrong', async () => {
    const app = buildValidationApp({
      body: { amount: { required: true, type: 'number' } },
    });
    const res = await request(app).post('/test').send({ amount: 'not-a-number' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when value is below min', async () => {
    const app = buildValidationApp({
      body: { amount: { required: true, type: 'number', min: 100 } },
    });
    const res = await request(app).post('/test').send({ amount: 50 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when value is not in oneOf', async () => {
    const app = buildValidationApp({
      body: { status: { required: true, type: 'string', oneOf: ['pending', 'paid'] } },
    });
    const res = await request(app).post('/test').send({ status: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('allows optional fields to be absent', async () => {
    const app = buildValidationApp({
      body: { note: { required: false, type: 'string' } },
    });
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(200);
  });
});
