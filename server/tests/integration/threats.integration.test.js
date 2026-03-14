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

  await testDb.schema.createTable('disputes', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants');
    t.integer('customer_id').notNullable().references('id').inTable('customers');
    t.integer('invoice_id').notNullable().references('id').inTable('invoices');
    t.text('claim_details').notNullable();
    t.text('status').notNullable().defaultTo('open');
    t.text('verification_status');
    t.text('resolution_type');
    t.text('resolution_details');
    t.text('created_at').notNullable().defaultTo(testDb.fn.now());
    t.text('resolved_at');
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
  await testDb('threats').del();
  await testDb('disputes').del();
  await testDb('transactions').del();
  await testDb('invoices').del();
});

function authHeader() {
  return { 'X-API-Key': API_KEY };
}

describe('Threat API Routes', () => {
  describe('Authentication', () => {
    it('returns 401 without API key', async () => {
      const res = await request(app).get('/api/v1/threats');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/threats', () => {
    it('returns empty array when no threats exist', async () => {
      const res = await request(app).get('/api/v1/threats').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns threats ordered by created_at desc', async () => {
      await testDb('threats').insert([
        { merchant_id: 1, threat_type: 'high_refund_ratio', severity: 'high', description: 'Refund ratio exceeded', status: 'active', created_at: '2025-01-01T00:00:00.000Z' },
        { merchant_id: 1, threat_type: 'slow_collections', severity: 'medium', description: 'Slow collections detected', status: 'active', created_at: '2025-01-02T00:00:00.000Z' },
      ]);

      const res = await request(app).get('/api/v1/threats').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].threat_type).toBe('slow_collections'); // most recent first
    });

    it('filters by severity', async () => {
      await testDb('threats').insert([
        { merchant_id: 1, threat_type: 'high_refund_ratio', severity: 'high', description: 'High refund', status: 'active' },
        { merchant_id: 1, threat_type: 'slow_collections', severity: 'medium', description: 'Slow', status: 'active' },
      ]);

      const res = await request(app).get('/api/v1/threats?severity=high').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].severity).toBe('high');
    });

    it('filters by status', async () => {
      await testDb('threats').insert([
        { merchant_id: 1, threat_type: 'high_refund_ratio', severity: 'high', description: 'Active threat', status: 'active' },
        { merchant_id: 1, threat_type: 'slow_collections', severity: 'medium', description: 'Resolved threat', status: 'resolved' },
      ]);

      const res = await request(app).get('/api/v1/threats?status=active').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('active');
    });

    it('returns 400 for invalid severity filter', async () => {
      const res = await request(app).get('/api/v1/threats?severity=invalid').set(authHeader());
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid status filter', async () => {
      const res = await request(app).get('/api/v1/threats?status=invalid').set(authHeader());
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/threats/evaluate', () => {
    it('runs threat evaluation and returns results', async () => {
      const res = await request(app).post('/api/v1/threats/evaluate').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('detects high refund ratio threat', async () => {
      const now = new Date();
      // Create transactions with high refund ratio in last 30 days
      for (let i = 0; i < 5; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i - 1);
        await testDb('transactions').insert({
          merchant_id: 1, type: 'incoming', amount: 1000,
          created_at: date.toISOString(),
        });
      }
      // Add refunds exceeding 30% threshold
      for (let i = 0; i < 5; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i - 1);
        await testDb('transactions').insert({
          merchant_id: 1, type: 'outgoing', amount: 800,
          created_at: date.toISOString(),
        });
      }

      const res = await request(app).post('/api/v1/threats/evaluate').set(authHeader());
      expect(res.status).toBe(200);
      // Should detect high refund ratio (4000/5000 = 80% > 30%)
      const refundThreats = res.body.data.filter(t => t.threat_type === 'high_refund_ratio');
      expect(refundThreats.length).toBeGreaterThanOrEqual(1);
    });
  });
});
