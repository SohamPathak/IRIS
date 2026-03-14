import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

// Ensure env is loaded before importing app
process.env.API_KEY = 'iris-dev-key';

const { default: app } = await import('../../../src/app.js');

describe('Express app', () => {
  it('GET /api/health returns success without auth', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });

  it('GET /api/v1/anything returns 401 without API key', async () => {
    const res = await request(app).get('/api/v1/invoices');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTH_MISSING_KEY');
  });

  it('GET /api/v1/nonexistent returns 404 with valid API key', async () => {
    const res = await request(app)
      .get('/api/v1/nonexistent-route')
      .set('X-API-Key', 'iris-dev-key');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('returns consistent error envelope for unknown routes', async () => {
    const res = await request(app).get('/totally/unknown');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code');
    expect(res.body.error).toHaveProperty('message');
    expect(res.body.error).toHaveProperty('details');
  });
});
