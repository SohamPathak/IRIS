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

  await testDb.schema.createTable('invoice_status_history', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id').notNullable().references('id').inTable('invoices');
    t.text('old_status');
    t.text('new_status').notNullable();
    t.text('changed_at').notNullable().defaultTo(testDb.fn.now());
    t.text('reason');
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

  await testDb.schema.createTable('customer_response_profiles', (t) => {
    t.increments('id').primary();
    t.integer('customer_id').notNullable().references('id').inTable('customers');
    t.text('escalation_level').notNullable();
    t.text('channel').notNullable();
    t.integer('attempts').notNullable().defaultTo(0);
    t.integer('successes').notNullable().defaultTo(0);
    t.real('success_rate').notNullable().defaultTo(0);
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

  const supertest = await import('supertest');
  request = supertest.default;
});

afterAll(async () => {
  await testDb.destroy();
});

beforeEach(async () => {
  await testDb('action_logs').del();
  await testDb('customer_response_profiles').del();
  await testDb('reminders').del();
  await testDb('invoice_status_history').del();
  await testDb('invoices').del();
});

function authHeader() {
  return { 'X-API-Key': API_KEY };
}

describe('Reminder API Routes', () => {
  // ─── Authentication ───
  describe('Authentication', () => {
    it('returns 401 without API key', async () => {
      const res = await request(app).get('/api/v1/reminders');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── GET /api/v1/reminders ───
  describe('GET /api/v1/reminders', () => {
    it('returns empty array when no reminders exist', async () => {
      const res = await request(app).get('/api/v1/reminders').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns all reminders', async () => {
      // Insert an overdue invoice and reminders directly
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 5000, balance_due: 5000, status: 'overdue',
        due_date: '2025-01-01',
      });
      await testDb('reminders').insert([
        { invoice_id: 1, customer_id: 1, escalation_level: 'friendly', channel: 'email', payment_link: 'https://pinelabs.mock/pay/1?amount=5000', status: 'sent' },
        { invoice_id: 1, customer_id: 1, escalation_level: 'firm', channel: 'email', payment_link: 'https://pinelabs.mock/pay/1?amount=5000', status: 'sent' },
      ]);

      const res = await request(app).get('/api/v1/reminders').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    it('filters by escalation_level', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 5000, balance_due: 5000, status: 'overdue',
        due_date: '2025-01-01',
      });
      await testDb('reminders').insert([
        { invoice_id: 1, customer_id: 1, escalation_level: 'friendly', channel: 'email', payment_link: 'link1', status: 'sent' },
        { invoice_id: 1, customer_id: 1, escalation_level: 'firm', channel: 'email', payment_link: 'link2', status: 'sent' },
      ]);

      const res = await request(app)
        .get('/api/v1/reminders?escalation_level=friendly')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].escalation_level).toBe('friendly');
    });

    it('filters by invoice_id', async () => {
      await testDb('invoices').insert([
        { id: 1, merchant_id: 1, customer_id: 1, amount: 5000, balance_due: 5000, status: 'overdue', due_date: '2025-01-01' },
        { id: 2, merchant_id: 1, customer_id: 1, amount: 3000, balance_due: 3000, status: 'overdue', due_date: '2025-01-01' },
      ]);
      await testDb('reminders').insert([
        { invoice_id: 1, customer_id: 1, escalation_level: 'friendly', channel: 'email', payment_link: 'link1', status: 'sent' },
        { invoice_id: 2, customer_id: 1, escalation_level: 'friendly', channel: 'email', payment_link: 'link2', status: 'sent' },
      ]);

      const res = await request(app)
        .get('/api/v1/reminders?invoice_id=1')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].invoice_id).toBe(1);
    });

    it('filters by customer_id', async () => {
      await testDb('customers').insert({
        id: 2, merchant_id: 1, name: 'Customer 2',
        email: 'c2@test.com', phone: '9876543211',
      });
      await testDb('invoices').insert([
        { id: 1, merchant_id: 1, customer_id: 1, amount: 5000, balance_due: 5000, status: 'overdue', due_date: '2025-01-01' },
        { id: 2, merchant_id: 1, customer_id: 2, amount: 3000, balance_due: 3000, status: 'overdue', due_date: '2025-01-01' },
      ]);
      await testDb('reminders').insert([
        { invoice_id: 1, customer_id: 1, escalation_level: 'friendly', channel: 'email', payment_link: 'link1', status: 'sent' },
        { invoice_id: 2, customer_id: 2, escalation_level: 'friendly', channel: 'email', payment_link: 'link2', status: 'sent' },
      ]);

      const res = await request(app)
        .get('/api/v1/reminders?customer_id=2')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].customer_id).toBe(2);
    });

    it('filters by status', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 5000, balance_due: 5000, status: 'overdue',
        due_date: '2025-01-01',
      });
      await testDb('reminders').insert([
        { invoice_id: 1, customer_id: 1, escalation_level: 'friendly', channel: 'email', payment_link: 'link1', status: 'sent' },
        { invoice_id: 1, customer_id: 1, escalation_level: 'firm', channel: 'email', payment_link: 'link2', status: 'responded', responded_at: '2025-06-01' },
      ]);

      const res = await request(app)
        .get('/api/v1/reminders?status=responded')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('responded');
    });

    it('returns 400 for invalid escalation_level filter', async () => {
      const res = await request(app)
        .get('/api/v1/reminders?escalation_level=invalid')
        .set(authHeader());
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/v1/reminders/trigger ───
  describe('POST /api/v1/reminders/trigger', () => {
    it('marks overdue invoices and sends friendly reminders', async () => {
      // Insert a pending invoice with a past due date
      const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 10000, balance_due: 10000, status: 'pending',
        due_date: pastDate,
      });

      const res = await request(app)
        .post('/api/v1/reminders/trigger')
        .set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.marked_overdue).toBe(1);
      expect(res.body.data.reminders_sent).toBe(1);

      // Verify invoice is now overdue
      const invoice = await testDb('invoices').where({ id: 1 }).first();
      expect(invoice.status).toBe('overdue');

      // Verify reminder was created
      const reminders = await testDb('reminders').where({ invoice_id: 1 });
      expect(reminders).toHaveLength(1);
      expect(reminders[0].escalation_level).toBe('friendly');
      expect(reminders[0].payment_link).toBeTruthy();
    });

    it('returns zeros when no overdue invoices exist', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 10000, balance_due: 10000, status: 'pending',
        due_date: futureDate,
      });

      const res = await request(app)
        .post('/api/v1/reminders/trigger')
        .set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.marked_overdue).toBe(0);
      expect(res.body.data.reminders_sent).toBe(0);
      expect(res.body.data.escalated).toBe(0);
    });

    it('escalates old unanswered reminders', async () => {
      // Insert an overdue invoice with a friendly reminder sent 8 days ago
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 10000, balance_due: 10000, status: 'overdue',
        due_date: '2025-01-01',
      });
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      await testDb('reminders').insert({
        invoice_id: 1, customer_id: 1, escalation_level: 'friendly',
        channel: 'email', payment_link: 'link1', status: 'sent',
        sent_at: eightDaysAgo,
      });

      const res = await request(app)
        .post('/api/v1/reminders/trigger')
        .set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.escalated).toBe(1);

      // Verify firm reminder was created
      const firmReminders = await testDb('reminders')
        .where({ invoice_id: 1, escalation_level: 'firm' });
      expect(firmReminders).toHaveLength(1);
    });

    it('logs actions in action_logs', async () => {
      const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 10000, balance_due: 10000, status: 'pending',
        due_date: pastDate,
      });

      await request(app)
        .post('/api/v1/reminders/trigger')
        .set(authHeader());

      const logs = await testDb('action_logs').where({ agent_type: 'collection' });
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].decision_type).toBe('send_reminder');
      expect(logs[0].reasoning).toBeTruthy();
    });
  });
});
