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

  // Create required tables
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

  await testDb.schema.createTable('threats', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants');
    t.text('threat_type').notNullable();
    t.text('severity').notNullable();
    t.text('description').notNullable();
    t.text('recommended_actions');
    t.integer('related_customer_id').references('id').inTable('customers');
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
    { id: 1, merchant_id: 1, name: 'Customer A', email: 'a@test.com', phone: '9876543210', risk_score: 75, risk_category: 'high' },
    { id: 2, merchant_id: 1, name: 'Customer B', email: 'b@test.com', phone: '9876543211', risk_score: 30, risk_category: 'low' },
  ]);

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
  await testDb('action_logs').del();
  await testDb('transactions').del();
  await testDb('threats').del();
  await testDb('invoices').del();
});

function authHeader() {
  return { 'X-API-Key': API_KEY };
}

describe('Dashboard API Routes', () => {
  describe('Authentication', () => {
    it('returns 401 without API key', async () => {
      const res = await request(app).get('/api/v1/dashboard/summary');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/dashboard/summary', () => {
    it('returns a quick summary with all required sections', async () => {
      // Seed some invoices and transactions for the summary
      await testDb('invoices').insert([
        { merchant_id: 1, customer_id: 1, amount: 5000, balance_due: 5000, status: 'overdue', due_date: '2025-01-01' },
        { merchant_id: 1, customer_id: 2, amount: 3000, balance_due: 0, status: 'paid', due_date: '2025-02-01', paid_at: '2025-02-01' },
      ]);

      const res = await request(app).get('/api/v1/dashboard/summary').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.summary).toBeDefined();
      expect(typeof res.body.data.summary).toBe('string');
      expect(res.body.data.wordCount).toBeLessThan(200);
      expect(res.body.data.sections).toBeDefined();
      expect(res.body.data.sections.collectionTrend).toBeDefined();
      expect(res.body.data.sections.refundTrend).toBeDefined();
      expect(res.body.data.sections.topRiskCustomers).toBeDefined();
      expect(res.body.data.sections.activeThreats).toBeDefined();
      expect(res.body.data.sections.recommendations).toBeDefined();
    });

    it('accepts merchant_id query parameter', async () => {
      const res = await request(app).get('/api/v1/dashboard/summary?merchant_id=1').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/v1/dashboard/metrics', () => {
    it('returns all key metric fields', async () => {
      const res = await request(app).get('/api/v1/dashboard/metrics').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data).toHaveProperty('total_receivables');
      expect(data).toHaveProperty('total_collected');
      expect(data).toHaveProperty('total_refunded');
      expect(data).toHaveProperty('net_position');
      expect(data).toHaveProperty('collection_rate');
    });

    it('returns zero metrics when no data exists', async () => {
      const res = await request(app).get('/api/v1/dashboard/metrics').set(authHeader());
      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.total_receivables).toBe(0);
      expect(data.total_collected).toBe(0);
      expect(data.total_refunded).toBe(0);
      expect(data.net_position).toBe(0);
      expect(data.collection_rate).toBe(0);
    });

    it('computes metrics correctly from invoices and transactions', async () => {
      // Create invoices: one pending (balance_due=5000), one paid (balance_due=0)
      await testDb('invoices').insert([
        { merchant_id: 1, customer_id: 1, amount: 5000, balance_due: 5000, status: 'pending', due_date: '2025-06-01' },
        { merchant_id: 1, customer_id: 2, amount: 3000, balance_due: 0, status: 'paid', due_date: '2025-05-01', paid_at: '2025-05-15' },
      ]);
      // Create transactions: 3000 incoming, 500 outgoing
      await testDb('transactions').insert([
        { merchant_id: 1, type: 'incoming', amount: 3000, created_at: '2025-05-15' },
        { merchant_id: 1, type: 'outgoing', amount: 500, created_at: '2025-05-20' },
      ]);

      const res = await request(app).get('/api/v1/dashboard/metrics').set(authHeader());
      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.total_receivables).toBe(5000);
      expect(data.total_collected).toBe(3000);
      expect(data.total_refunded).toBe(500);
      expect(data.net_position).toBe(2500);
      // collection_rate = (3000 / (3000 + 5000)) * 100 = 37.5
      expect(data.collection_rate).toBe(37.5);
    });

    it('excludes paid invoices from total receivables', async () => {
      await testDb('invoices').insert([
        { merchant_id: 1, customer_id: 1, amount: 5000, balance_due: 0, status: 'paid', due_date: '2025-06-01', paid_at: '2025-06-01' },
        { merchant_id: 1, customer_id: 2, amount: 2000, balance_due: 2000, status: 'overdue', due_date: '2025-04-01' },
      ]);

      const res = await request(app).get('/api/v1/dashboard/metrics').set(authHeader());
      expect(res.body.data.total_receivables).toBe(2000);
    });
  });

  describe('GET /api/v1/dashboard/action-log', () => {
    it('returns empty array when no action logs exist', async () => {
      const res = await request(app).get('/api/v1/dashboard/action-log').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns action logs in reverse chronological order', async () => {
      await testDb('action_logs').insert([
        { merchant_id: 1, agent_type: 'collection_agent', decision_type: 'send_reminder', inputs: '{}', policy_rules_applied: '[]', outcome: 'sent', reasoning: 'Overdue invoice', created_at: '2025-01-01T10:00:00Z' },
        { merchant_id: 1, agent_type: 'deduction_agent', decision_type: 'resolve_dispute', inputs: '{}', policy_rules_applied: '[]', outcome: 'refunded', reasoning: 'Policy match', created_at: '2025-01-02T10:00:00Z' },
        { merchant_id: 1, agent_type: 'collection_agent', decision_type: 'flag_risk', inputs: '{}', policy_rules_applied: '[]', outcome: 'flagged', reasoning: 'High overdue', created_at: '2025-01-03T10:00:00Z' },
      ]);

      const res = await request(app).get('/api/v1/dashboard/action-log').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      // Most recent first
      expect(res.body.data[0].created_at).toBe('2025-01-03T10:00:00Z');
      expect(res.body.data[1].created_at).toBe('2025-01-02T10:00:00Z');
      expect(res.body.data[2].created_at).toBe('2025-01-01T10:00:00Z');
    });

    it('filters by agent_type', async () => {
      await testDb('action_logs').insert([
        { merchant_id: 1, agent_type: 'collection_agent', decision_type: 'send_reminder', inputs: '{}', policy_rules_applied: '[]', outcome: 'sent', reasoning: 'Overdue', created_at: '2025-01-01' },
        { merchant_id: 1, agent_type: 'deduction_agent', decision_type: 'resolve_dispute', inputs: '{}', policy_rules_applied: '[]', outcome: 'refunded', reasoning: 'Policy', created_at: '2025-01-02' },
      ]);

      const res = await request(app).get('/api/v1/dashboard/action-log?agent_type=collection_agent').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].agent_type).toBe('collection_agent');
    });

    it('filters by decision_type', async () => {
      await testDb('action_logs').insert([
        { merchant_id: 1, agent_type: 'collection_agent', decision_type: 'send_reminder', inputs: '{}', policy_rules_applied: '[]', outcome: 'sent', reasoning: 'Overdue', created_at: '2025-01-01' },
        { merchant_id: 1, agent_type: 'collection_agent', decision_type: 'flag_risk', inputs: '{}', policy_rules_applied: '[]', outcome: 'flagged', reasoning: 'High risk', created_at: '2025-01-02' },
      ]);

      const res = await request(app).get('/api/v1/dashboard/action-log?decision_type=flag_risk').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].decision_type).toBe('flag_risk');
    });

    it('filters by date range', async () => {
      await testDb('action_logs').insert([
        { merchant_id: 1, agent_type: 'collection_agent', decision_type: 'send_reminder', inputs: '{}', policy_rules_applied: '[]', outcome: 'sent', reasoning: 'Overdue', created_at: '2025-01-01T10:00:00Z' },
        { merchant_id: 1, agent_type: 'collection_agent', decision_type: 'flag_risk', inputs: '{}', policy_rules_applied: '[]', outcome: 'flagged', reasoning: 'High risk', created_at: '2025-01-15T10:00:00Z' },
        { merchant_id: 1, agent_type: 'deduction_agent', decision_type: 'resolve_dispute', inputs: '{}', policy_rules_applied: '[]', outcome: 'refunded', reasoning: 'Policy', created_at: '2025-02-01T10:00:00Z' },
      ]);

      const res = await request(app)
        .get('/api/v1/dashboard/action-log?start_date=2025-01-10&end_date=2025-01-20')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].decision_type).toBe('flag_risk');
    });

    it('returns 400 for invalid agent_type', async () => {
      const res = await request(app).get('/api/v1/dashboard/action-log?agent_type=invalid').set(authHeader());
      expect(res.status).toBe(400);
    });

    it('combines multiple filters', async () => {
      await testDb('action_logs').insert([
        { merchant_id: 1, agent_type: 'collection_agent', decision_type: 'send_reminder', inputs: '{}', policy_rules_applied: '[]', outcome: 'sent', reasoning: 'Overdue', created_at: '2025-01-05T10:00:00Z' },
        { merchant_id: 1, agent_type: 'collection_agent', decision_type: 'flag_risk', inputs: '{}', policy_rules_applied: '[]', outcome: 'flagged', reasoning: 'High risk', created_at: '2025-01-15T10:00:00Z' },
        { merchant_id: 1, agent_type: 'deduction_agent', decision_type: 'send_reminder', inputs: '{}', policy_rules_applied: '[]', outcome: 'sent', reasoning: 'Follow up', created_at: '2025-01-15T10:00:00Z' },
      ]);

      const res = await request(app)
        .get('/api/v1/dashboard/action-log?agent_type=collection_agent&decision_type=send_reminder')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].agent_type).toBe('collection_agent');
      expect(res.body.data[0].decision_type).toBe('send_reminder');
    });
  });
});
