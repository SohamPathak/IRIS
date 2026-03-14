import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import knex from 'knex';

let testDb;
let app;
const API_KEY = 'test-api-key';

beforeAll(async () => {
  // Set env before any app imports
  process.env.API_KEY = API_KEY;

  testDb = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn, cb) => {
        conn.pragma('journal_mode = WAL');
        conn.pragma('foreign_keys = ON');
        cb();
      },
    },
  });

  // Create tables
  await testDb.schema.createTable('merchants', (t) => {
    t.increments('id').primary();
    t.text('name').notNullable();
    t.text('email').notNullable();
    t.text('business_type').notNullable();
    t.text('api_key').notNullable();
    t.text('created_at').notNullable().defaultTo(testDb.fn.now());
  });

  await testDb.schema.createTable('customers', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants');
    t.text('name').notNullable();
    t.text('email').notNullable();
    t.text('phone').notNullable();
    t.real('risk_score').notNullable().defaultTo(50);
    t.text('risk_category').notNullable().defaultTo('medium');
    t.text('created_at').notNullable().defaultTo(testDb.fn.now());
  });

  await testDb.schema.createTable('invoices', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants');
    t.integer('customer_id').notNullable().references('id').inTable('customers');
    t.real('amount').notNullable();
    t.real('balance_due').notNullable();
    t.text('status').notNullable().defaultTo('pending');
    t.text('due_date').notNullable();
    t.text('paid_at');
    t.text('created_at').notNullable().defaultTo(testDb.fn.now());
  });

  await testDb.schema.createTable('invoice_line_items', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id').notNullable().references('id').inTable('invoices');
    t.text('description').notNullable();
    t.integer('quantity').notNullable().defaultTo(1);
    t.real('unit_price').notNullable();
    t.real('total').notNullable();
  });

  await testDb.schema.createTable('invoice_status_history', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id').notNullable().references('id').inTable('invoices');
    t.text('old_status');
    t.text('new_status').notNullable();
    t.text('changed_at').notNullable().defaultTo(testDb.fn.now());
    t.text('reason');
  });

  // Seed FK references
  await testDb('merchants').insert({
    id: 1, name: 'Test Merchant', email: 'merchant@test.com',
    business_type: 'retail', api_key: 'test-key',
  });
  await testDb('customers').insert({
    id: 1, merchant_id: 1, name: 'Test Customer',
    email: 'customer@test.com', phone: '9876543210',
  });

  // Mock db module
  vi.doMock('../../src/db.js', () => ({ default: testDb }));

  // Dynamic import after mock
  const { default: appModule } = await import('../../src/app.js');
  app = appModule;
});

afterAll(async () => {
  await testDb.destroy();
});

beforeEach(async () => {
  await testDb('invoice_status_history').del();
  await testDb('invoice_line_items').del();
  await testDb('invoices').del();
});

function authHeader() {
  return { 'X-API-Key': API_KEY };
}

function makeInvoiceBody(overrides = {}) {
  return {
    merchant_id: 1,
    customer_id: 1,
    amount: 10000,
    due_date: '2025-06-15',
    line_items: [
      { description: 'Widget A', quantity: 2, unit_price: 3000 },
      { description: 'Widget B', quantity: 1, unit_price: 4000 },
    ],
    ...overrides,
  };
}

// Inline supertest-like helper using native fetch on the app
// We use dynamic import of supertest
let request;
beforeAll(async () => {
  const supertest = await import('supertest');
  request = supertest.default;
});

describe('Invoice API Routes', () => {
  // ─── Authentication ───
  describe('Authentication', () => {
    it('returns 401 without API key', async () => {
      const res = await request(app).get('/api/v1/invoices');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 401 with invalid API key', async () => {
      const res = await request(app)
        .get('/api/v1/invoices')
        .set('X-API-Key', 'wrong-key');
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /api/v1/invoices ───
  describe('POST /api/v1/invoices', () => {
    it('creates an invoice and returns 201', async () => {
      const res = await request(app)
        .post('/api/v1/invoices')
        .set(authHeader())
        .send(makeInvoiceBody());

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.amount).toBe(10000);
      expect(res.body.data.balance_due).toBe(10000);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.line_items).toHaveLength(2);
    });

    it('creates invoice without line items', async () => {
      const res = await request(app)
        .post('/api/v1/invoices')
        .set(authHeader())
        .send(makeInvoiceBody({ line_items: undefined }));

      expect(res.status).toBe(201);
      expect(res.body.data.line_items).toHaveLength(0);
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/v1/invoices')
        .set(authHeader())
        .send({ merchant_id: 1 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when amount is negative', async () => {
      const res = await request(app)
        .post('/api/v1/invoices')
        .set(authHeader())
        .send(makeInvoiceBody({ amount: -100 }));

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /api/v1/invoices ───
  describe('GET /api/v1/invoices', () => {
    it('returns all invoices', async () => {
      await request(app).post('/api/v1/invoices').set(authHeader()).send(makeInvoiceBody());
      await request(app).post('/api/v1/invoices').set(authHeader()).send(makeInvoiceBody({ amount: 5000 }));

      const res = await request(app).get('/api/v1/invoices').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it('filters by status', async () => {
      const createRes = await request(app).post('/api/v1/invoices').set(authHeader()).send(makeInvoiceBody());
      await request(app).post('/api/v1/invoices').set(authHeader()).send(makeInvoiceBody({ amount: 5000 }));
      // Pay the first one
      await request(app).patch(`/api/v1/invoices/${createRes.body.data.id}/pay`).set(authHeader());

      const res = await request(app).get('/api/v1/invoices?status=paid').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('paid');
    });

    it('filters by date range', async () => {
      await request(app).post('/api/v1/invoices').set(authHeader()).send(makeInvoiceBody({ due_date: '2025-01-01' }));
      await request(app).post('/api/v1/invoices').set(authHeader()).send(makeInvoiceBody({ due_date: '2025-06-15' }));

      const res = await request(app)
        .get('/api/v1/invoices?date_from=2025-05-01&date_to=2025-07-01')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('returns empty array when no matches', async () => {
      const res = await request(app).get('/api/v1/invoices?status=paid').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns 400 for invalid status filter', async () => {
      const res = await request(app).get('/api/v1/invoices?status=invalid').set(authHeader());
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /api/v1/invoices/:id ───
  describe('GET /api/v1/invoices/:id', () => {
    it('returns invoice with line items and history', async () => {
      const createRes = await request(app).post('/api/v1/invoices').set(authHeader()).send(makeInvoiceBody());
      const id = createRes.body.data.id;

      const res = await request(app).get(`/api/v1/invoices/${id}`).set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(id);
      expect(res.body.data.line_items).toHaveLength(2);
      expect(res.body.data.status_history).toHaveLength(1);
    });

    it('returns 404 for non-existent invoice', async () => {
      const res = await request(app).get('/api/v1/invoices/99999').set(authHeader());
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVOICE_NOT_FOUND');
    });
  });

  // ─── PATCH /api/v1/invoices/:id/pay ───
  describe('PATCH /api/v1/invoices/:id/pay', () => {
    it('records full payment', async () => {
      const createRes = await request(app).post('/api/v1/invoices').set(authHeader()).send(makeInvoiceBody());
      const id = createRes.body.data.id;

      const res = await request(app).patch(`/api/v1/invoices/${id}/pay`).set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
      expect(res.body.data.balance_due).toBe(0);
      expect(res.body.data.paid_at).toBeDefined();
    });

    it('returns 404 for non-existent invoice', async () => {
      const res = await request(app).patch('/api/v1/invoices/99999/pay').set(authHeader());
      expect(res.status).toBe(404);
    });
  });

  // ─── PATCH /api/v1/invoices/:id/partial-pay ───
  describe('PATCH /api/v1/invoices/:id/partial-pay', () => {
    it('records partial payment and reduces balance', async () => {
      const createRes = await request(app)
        .post('/api/v1/invoices').set(authHeader())
        .send(makeInvoiceBody({ amount: 10000 }));
      const id = createRes.body.data.id;

      const res = await request(app)
        .patch(`/api/v1/invoices/${id}/partial-pay`)
        .set(authHeader())
        .send({ amount: 3000 });

      expect(res.status).toBe(200);
      expect(res.body.data.balance_due).toBe(7000);
      expect(res.body.data.status).toBe('partial');
    });

    it('returns 400 when amount is missing', async () => {
      const createRes = await request(app).post('/api/v1/invoices').set(authHeader()).send(makeInvoiceBody());
      const id = createRes.body.data.id;

      const res = await request(app)
        .patch(`/api/v1/invoices/${id}/partial-pay`)
        .set(authHeader())
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 when amount exceeds balance', async () => {
      const createRes = await request(app)
        .post('/api/v1/invoices').set(authHeader())
        .send(makeInvoiceBody({ amount: 5000 }));
      const id = createRes.body.data.id;

      const res = await request(app)
        .patch(`/api/v1/invoices/${id}/partial-pay`)
        .set(authHeader())
        .send({ amount: 6000 });

      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent invoice', async () => {
      const res = await request(app)
        .patch('/api/v1/invoices/99999/partial-pay')
        .set(authHeader())
        .send({ amount: 100 });

      expect(res.status).toBe(404);
    });
  });
});
