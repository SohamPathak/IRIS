import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import knex from 'knex';

let testDb;
let app;
let request;
const API_KEY = 'test-api-key';

beforeAll(async () => {
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

  await testDb.schema.createTable('transactions', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants');
    t.text('type').notNullable();
    t.real('amount').notNullable();
    t.text('reference_type');
    t.integer('reference_id');
    t.text('pine_labs_ref');
    t.text('created_at').notNullable().defaultTo(testDb.fn.now());
  });

  await testDb.schema.createTable('cash_flow_predictions', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants');
    t.text('prediction_date').notNullable();
    t.real('predicted_incoming').notNullable();
    t.real('predicted_outgoing').notNullable();
    t.real('predicted_net').notNullable();
    t.text('generated_at').notNullable();
  });

  await testDb.schema.createTable('threats', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants');
    t.text('threat_type').notNullable();
    t.text('severity').notNullable();
    t.text('description').notNullable();
    t.text('recommended_actions');
    t.integer('related_customer_id');
    t.text('status').notNullable().defaultTo('active');
    t.text('created_at').notNullable().defaultTo(testDb.fn.now());
  });

  await testDb.schema.createTable('policy_rules', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants');
    t.text('name').notNullable();
    t.text('condition_type').notNullable();
    t.text('condition_value').notNullable();
    t.text('action_type').notNullable();
    t.text('action_value').notNullable();
    t.integer('is_active').notNullable().defaultTo(1);
    t.text('created_at').notNullable().defaultTo(testDb.fn.now());
    t.text('updated_at').notNullable().defaultTo(testDb.fn.now());
  });

  // Seed base data
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

  const { default: appModule } = await import('../../src/app.js');
  app = appModule;

  const supertest = await import('supertest');
  request = supertest.default;
});

afterAll(async () => {
  await testDb.destroy();
});

beforeEach(async () => {
  await testDb('cash_flow_predictions').del();
  await testDb('threats').del();
  await testDb('transactions').del();
  await testDb('invoices').del();
});

function authHeader() {
  return { 'X-API-Key': API_KEY };
}

describe('Treasury API Routes', () => {
  describe('Authentication', () => {
    it('returns 401 without API key', async () => {
      const res = await request(app).get('/api/v1/treasury/cash-flow');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/treasury/cash-flow', () => {
    it('returns cash flow summary with default date range', async () => {
      const now = new Date();
      await testDb('transactions').insert([
        { merchant_id: 1, type: 'incoming', amount: 10000, created_at: now.toISOString() },
        { merchant_id: 1, type: 'outgoing', amount: 3000, created_at: now.toISOString() },
      ]);

      const res = await request(app).get('/api/v1/treasury/cash-flow').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total_incoming).toBe(10000);
      expect(res.body.data.total_outgoing).toBe(3000);
      expect(res.body.data.net_balance).toBe(7000);
      expect(res.body.data.transaction_count).toBe(2);
      expect(res.body.data.period).toBeDefined();
    });

    it('filters by date range', async () => {
      await testDb('transactions').insert([
        { merchant_id: 1, type: 'incoming', amount: 5000, created_at: '2025-01-15T00:00:00.000Z' },
        { merchant_id: 1, type: 'incoming', amount: 8000, created_at: '2025-02-15T00:00:00.000Z' },
      ]);

      const res = await request(app)
        .get('/api/v1/treasury/cash-flow?start_date=2025-02-01T00:00:00.000Z&end_date=2025-03-01T00:00:00.000Z')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data.total_incoming).toBe(8000);
      expect(res.body.data.transaction_count).toBe(1);
    });

    it('returns zeros when no transactions exist in period', async () => {
      const res = await request(app)
        .get('/api/v1/treasury/cash-flow?start_date=2025-01-01T00:00:00.000Z&end_date=2025-01-31T00:00:00.000Z')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data.total_incoming).toBe(0);
      expect(res.body.data.total_outgoing).toBe(0);
      expect(res.body.data.net_balance).toBe(0);
    });
  });

  describe('GET /api/v1/treasury/transactions', () => {
    it('returns empty array when no transactions exist', async () => {
      const res = await request(app).get('/api/v1/treasury/transactions').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns transactions with running balance', async () => {
      await testDb('transactions').insert([
        { merchant_id: 1, type: 'incoming', amount: 10000, created_at: '2025-01-01T00:00:00.000Z' },
        { merchant_id: 1, type: 'outgoing', amount: 3000, created_at: '2025-01-02T00:00:00.000Z' },
        { merchant_id: 1, type: 'incoming', amount: 5000, created_at: '2025-01-03T00:00:00.000Z' },
      ]);

      const res = await request(app).get('/api/v1/treasury/transactions').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      // Running balance: 10000, 7000, 12000
      expect(res.body.data[0].running_balance).toBe(10000);
      expect(res.body.data[1].running_balance).toBe(7000);
      expect(res.body.data[2].running_balance).toBe(12000);
    });

    it('filters transactions by date range', async () => {
      await testDb('transactions').insert([
        { merchant_id: 1, type: 'incoming', amount: 5000, created_at: '2025-01-15T00:00:00.000Z' },
        { merchant_id: 1, type: 'incoming', amount: 8000, created_at: '2025-02-15T00:00:00.000Z' },
      ]);

      const res = await request(app)
        .get('/api/v1/treasury/transactions?start_date=2025-02-01T00:00:00.000Z&end_date=2025-03-01T00:00:00.000Z')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].amount).toBe(8000);
    });
  });

  describe('GET /api/v1/treasury/predictions', () => {
    it('returns 90-day predictions', async () => {
      // Add a pending invoice so predictions have data
      await testDb('invoices').insert({
        merchant_id: 1, customer_id: 1, amount: 10000, balance_due: 10000,
        status: 'pending', due_date: new Date(Date.now() + 15 * 86400000).toISOString(),
      });

      const res = await request(app).get('/api/v1/treasury/predictions').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(90);
      expect(res.body.data[0]).toHaveProperty('prediction_date');
      expect(res.body.data[0]).toHaveProperty('predicted_incoming');
      expect(res.body.data[0]).toHaveProperty('predicted_outgoing');
      expect(res.body.data[0]).toHaveProperty('predicted_net');
    });

    it('returns 90 predictions even with no invoices', async () => {
      const res = await request(app).get('/api/v1/treasury/predictions').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(90);
    });
  });

  describe('GET /api/v1/treasury/net-balance', () => {
    it('returns zero balance when no transactions exist', async () => {
      const res = await request(app).get('/api/v1/treasury/net-balance').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total_incoming).toBe(0);
      expect(res.body.data.total_outgoing).toBe(0);
      expect(res.body.data.net_balance).toBe(0);
    });

    it('computes correct net balance', async () => {
      await testDb('transactions').insert([
        { merchant_id: 1, type: 'incoming', amount: 25000 },
        { merchant_id: 1, type: 'incoming', amount: 15000 },
        { merchant_id: 1, type: 'outgoing', amount: 5000 },
      ]);

      const res = await request(app).get('/api/v1/treasury/net-balance').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data.total_incoming).toBe(40000);
      expect(res.body.data.total_outgoing).toBe(5000);
      expect(res.body.data.net_balance).toBe(35000);
    });
  });
});
