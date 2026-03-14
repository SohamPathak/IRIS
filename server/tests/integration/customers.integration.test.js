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

  await testDb.schema.createTable('reminders', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id').notNullable().references('id').inTable('invoices');
    t.integer('customer_id').notNullable().references('id').inTable('customers');
    t.text('escalation_level').notNullable();
    t.text('channel').notNullable();
    t.text('payment_link');
    t.text('status').notNullable().defaultTo('sent');
    t.text('sent_at').notNullable().defaultTo(testDb.fn.now());
    t.text('responded_at');
  });

  await testDb.schema.createTable('payment_plans', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id').notNullable().references('id').inTable('invoices');
    t.integer('customer_id').notNullable().references('id').inTable('customers');
    t.integer('num_installments').notNullable();
    t.real('installment_amount').notNullable();
    t.text('status').notNullable().defaultTo('active');
    t.text('created_at').notNullable().defaultTo(testDb.fn.now());
  });

  await testDb.schema.createTable('action_logs', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants');
    t.text('agent_type').notNullable();
    t.text('decision_type').notNullable();
    t.text('inputs');
    t.text('policy_rules_applied');
    t.text('outcome').notNullable();
    t.text('reasoning').notNullable();
    t.text('created_at').notNullable().defaultTo(testDb.fn.now());
  });

  // Seed base data
  await testDb('merchants').insert({
    id: 1, name: 'Test Merchant', email: 'merchant@test.com',
    business_type: 'retail', api_key: 'test-key',
  });
  await testDb('customers').insert([
    { id: 1, merchant_id: 1, name: 'Low Risk Customer', email: 'low@test.com', phone: '9876543210', risk_score: 20, risk_category: 'low' },
    { id: 2, merchant_id: 1, name: 'High Risk Customer', email: 'high@test.com', phone: '9876543211', risk_score: 80, risk_category: 'high' },
    { id: 3, merchant_id: 1, name: 'Medium Risk Customer', email: 'med@test.com', phone: '9876543212', risk_score: 50, risk_category: 'medium' },
  ]);

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
  await testDb('action_logs').del();
  await testDb('payment_plans').del();
  await testDb('reminders').del();
  await testDb('invoices').del();
});

function authHeader() {
  return { 'X-API-Key': API_KEY };
}

describe('Customer API Routes', () => {
  describe('Authentication', () => {
    it('returns 401 without API key', async () => {
      const res = await request(app).get('/api/v1/customers');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/customers', () => {
    it('returns all customers ordered by risk score desc', async () => {
      const res = await request(app).get('/api/v1/customers').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);
      // Should be ordered by risk_score descending
      expect(res.body.data[0].risk_score).toBeGreaterThanOrEqual(res.body.data[1].risk_score);
      expect(res.body.data[1].risk_score).toBeGreaterThanOrEqual(res.body.data[2].risk_score);
    });

    it('filters by risk_category', async () => {
      const res = await request(app)
        .get('/api/v1/customers?risk_category=high')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].risk_category).toBe('high');
    });

    it('filters by merchant_id', async () => {
      const res = await request(app)
        .get('/api/v1/customers?merchant_id=1')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
    });

    it('returns 400 for invalid risk_category', async () => {
      const res = await request(app)
        .get('/api/v1/customers?risk_category=invalid')
        .set(authHeader());
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/customers/:id', () => {
    it('returns customer detail with invoice summary and related data', async () => {
      await testDb('invoices').insert([
        { id: 1, merchant_id: 1, customer_id: 1, amount: 5000, balance_due: 5000, status: 'pending', due_date: '2025-06-01' },
        { id: 2, merchant_id: 1, customer_id: 1, amount: 3000, balance_due: 0, status: 'paid', due_date: '2025-05-01', paid_at: '2025-04-28' },
        { id: 3, merchant_id: 1, customer_id: 1, amount: 8000, balance_due: 8000, status: 'overdue', due_date: '2025-01-01' },
      ]);

      const res = await request(app)
        .get('/api/v1/customers/1')
        .set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(1);
      expect(res.body.data.name).toBe('Low Risk Customer');
      expect(res.body.data.invoice_summary).toBeDefined();
      expect(res.body.data.invoice_summary.total).toBe(3);
      expect(res.body.data.invoice_summary.pending).toBe(1);
      expect(res.body.data.invoice_summary.paid).toBe(1);
      expect(res.body.data.invoice_summary.overdue).toBe(1);
      expect(res.body.data.invoice_summary.total_outstanding).toBe(13000);
      expect(res.body.data.payment_plans).toBeDefined();
      expect(res.body.data.recent_reminders).toBeDefined();
    });

    it('returns 404 for non-existent customer', async () => {
      const res = await request(app)
        .get('/api/v1/customers/999')
        .set(authHeader());
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/customers/:id/risk-history', () => {
    it('returns risk history from action logs', async () => {
      await testDb('action_logs').insert({
        merchant_id: 1, agent_type: 'collection',
        decision_type: 'flag_high_risk',
        inputs: JSON.stringify({ customer_id: 2, risk_score: 80, total_overdue: 50000, threshold: 10000 }),
        policy_rules_applied: JSON.stringify([]),
        outcome: 'Flagged customer #2 as high-risk',
        reasoning: 'Customer #2 has overdue invoices exceeding threshold.',
      });

      const res = await request(app)
        .get('/api/v1/customers/2/risk-history')
        .set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.customer_id).toBe(2);
      expect(res.body.data.current_risk_score).toBe(80);
      expect(res.body.data.current_risk_category).toBe('high');
      expect(res.body.data.history).toHaveLength(1);
      expect(res.body.data.history[0].risk_score).toBe(80);
    });

    it('returns empty history when no risk logs exist', async () => {
      const res = await request(app)
        .get('/api/v1/customers/1/risk-history')
        .set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.history).toHaveLength(0);
    });

    it('returns 404 for non-existent customer', async () => {
      const res = await request(app)
        .get('/api/v1/customers/999/risk-history')
        .set(authHeader());
      expect(res.status).toBe(404);
    });
  });
});
