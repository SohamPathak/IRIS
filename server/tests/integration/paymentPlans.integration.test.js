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

  await testDb.schema.createTable('payment_plans', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id').notNullable().references('id').inTable('invoices');
    t.integer('customer_id').notNullable().references('id').inTable('customers');
    t.integer('num_installments').notNullable();
    t.real('installment_amount').notNullable();
    t.text('status').notNullable().defaultTo('active');
    t.text('created_at').notNullable().defaultTo(testDb.fn.now());
  });

  await testDb.schema.createTable('installments', (t) => {
    t.increments('id').primary();
    t.integer('payment_plan_id').notNullable().references('id').inTable('payment_plans');
    t.integer('installment_number').notNullable();
    t.real('amount').notNullable();
    t.text('due_date').notNullable();
    t.text('status').notNullable().defaultTo('pending');
    t.text('payment_link');
    t.text('paid_at');
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
  await testDb('action_logs').del();
  await testDb('installments').del();
  await testDb('payment_plans').del();
  await testDb('policy_rules').del();
  await testDb('reminders').del();
  await testDb('invoice_status_history').del();
  await testDb('invoices').del();
});

function authHeader() {
  return { 'X-API-Key': API_KEY };
}

describe('Payment Plan API Routes', () => {
  describe('Authentication', () => {
    it('returns 401 without API key', async () => {
      const res = await request(app).get('/api/v1/payment-plans');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/payment-plans', () => {
    it('returns empty array when no plans exist', async () => {
      const res = await request(app).get('/api/v1/payment-plans').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns plans with installments', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 9000, balance_due: 9000, status: 'overdue', due_date: '2025-01-01',
      });
      await testDb('payment_plans').insert({
        id: 1, invoice_id: 1, customer_id: 1,
        num_installments: 3, installment_amount: 3000, status: 'active',
      });
      await testDb('installments').insert([
        { id: 1, payment_plan_id: 1, installment_number: 1, amount: 3000, due_date: '2025-02-01', status: 'pending', payment_link: 'link1' },
        { id: 2, payment_plan_id: 1, installment_number: 2, amount: 3000, due_date: '2025-03-01', status: 'pending', payment_link: 'link2' },
        { id: 3, payment_plan_id: 1, installment_number: 3, amount: 3000, due_date: '2025-04-01', status: 'pending', payment_link: 'link3' },
      ]);

      const res = await request(app).get('/api/v1/payment-plans').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].installments).toHaveLength(3);
      expect(res.body.data[0].installments[0].installment_number).toBe(1);
    });

    it('filters by status', async () => {
      await testDb('invoices').insert([
        { id: 1, merchant_id: 1, customer_id: 1, amount: 9000, balance_due: 9000, status: 'overdue', due_date: '2025-01-01' },
        { id: 2, merchant_id: 1, customer_id: 1, amount: 6000, balance_due: 0, status: 'paid', due_date: '2025-01-01' },
      ]);
      await testDb('payment_plans').insert([
        { id: 1, invoice_id: 1, customer_id: 1, num_installments: 3, installment_amount: 3000, status: 'active' },
        { id: 2, invoice_id: 2, customer_id: 1, num_installments: 2, installment_amount: 3000, status: 'completed' },
      ]);

      const res = await request(app)
        .get('/api/v1/payment-plans?status=active')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('active');
    });

    it('filters by customer_id', async () => {
      await testDb('customers').insert({
        id: 2, merchant_id: 1, name: 'Customer 2',
        email: 'c2@test.com', phone: '9876543211',
      });
      await testDb('invoices').insert([
        { id: 1, merchant_id: 1, customer_id: 1, amount: 9000, balance_due: 9000, status: 'overdue', due_date: '2025-01-01' },
        { id: 2, merchant_id: 1, customer_id: 2, amount: 6000, balance_due: 6000, status: 'overdue', due_date: '2025-01-01' },
      ]);
      await testDb('payment_plans').insert([
        { id: 1, invoice_id: 1, customer_id: 1, num_installments: 3, installment_amount: 3000, status: 'active' },
        { id: 2, invoice_id: 2, customer_id: 2, num_installments: 2, installment_amount: 3000, status: 'active' },
      ]);

      const res = await request(app)
        .get('/api/v1/payment-plans?customer_id=2')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].customer_id).toBe(2);
    });

    it('returns 400 for invalid status filter', async () => {
      const res = await request(app)
        .get('/api/v1/payment-plans?status=invalid')
        .set(authHeader());
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/payment-plans', () => {
    it('creates a payment plan for an overdue invoice with EMI policy', async () => {
      const pastDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 9000, balance_due: 9000, status: 'overdue', due_date: pastDate,
      });
      await testDb('policy_rules').insert({
        merchant_id: 1, name: 'EMI after 30 days',
        condition_type: 'emi_eligibility',
        condition_value: JSON.stringify({ overdue_days: 30 }),
        action_type: 'offer_emi',
        action_value: JSON.stringify({ num_installments: 3 }),
      });

      const res = await request(app)
        .post('/api/v1/payment-plans')
        .set(authHeader())
        .send({ invoice_id: 1 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.plan).toBeDefined();
      expect(res.body.data.plan.num_installments).toBe(3);
      expect(res.body.data.installments).toHaveLength(3);
      // Each installment should have a payment link
      for (const inst of res.body.data.installments) {
        expect(inst.payment_link).toBeTruthy();
      }
    });

    it('returns 400 when invoice is not overdue', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 9000, balance_due: 9000, status: 'pending', due_date: futureDate,
      });

      const res = await request(app)
        .post('/api/v1/payment-plans')
        .set(authHeader())
        .send({ invoice_id: 1 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 for non-existent invoice', async () => {
      const res = await request(app)
        .post('/api/v1/payment-plans')
        .set(authHeader())
        .send({ invoice_id: 999 });

      expect(res.status).toBe(404);
    });

    it('returns 400 when missing invoice_id', async () => {
      const res = await request(app)
        .post('/api/v1/payment-plans')
        .set(authHeader())
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/v1/payment-plans/:id/installments/:installmentId/pay', () => {
    it('records installment payment', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 6000, balance_due: 6000, status: 'overdue', due_date: '2025-01-01',
      });
      await testDb('payment_plans').insert({
        id: 1, invoice_id: 1, customer_id: 1,
        num_installments: 2, installment_amount: 3000, status: 'active',
      });
      await testDb('installments').insert([
        { id: 1, payment_plan_id: 1, installment_number: 1, amount: 3000, due_date: '2025-02-01', status: 'pending', payment_link: 'link1' },
        { id: 2, payment_plan_id: 1, installment_number: 2, amount: 3000, due_date: '2025-03-01', status: 'pending', payment_link: 'link2' },
      ]);

      const res = await request(app)
        .patch('/api/v1/payment-plans/1/installments/1/pay')
        .set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.installment.status).toBe('paid');
      expect(res.body.data.installment.paid_at).toBeTruthy();
      // Plan should still be active (one installment remaining)
      expect(res.body.data.plan.status).toBe('active');
    });

    it('marks plan as completed when all installments paid', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 3000, balance_due: 3000, status: 'overdue', due_date: '2025-01-01',
      });
      await testDb('payment_plans').insert({
        id: 1, invoice_id: 1, customer_id: 1,
        num_installments: 1, installment_amount: 3000, status: 'active',
      });
      await testDb('installments').insert({
        id: 1, payment_plan_id: 1, installment_number: 1,
        amount: 3000, due_date: '2025-02-01', status: 'pending', payment_link: 'link1',
      });

      const res = await request(app)
        .patch('/api/v1/payment-plans/1/installments/1/pay')
        .set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.plan.status).toBe('completed');
    });

    it('returns 404 for non-existent plan', async () => {
      const res = await request(app)
        .patch('/api/v1/payment-plans/999/installments/1/pay')
        .set(authHeader());
      expect(res.status).toBe(404);
    });

    it('returns 404 for non-existent installment', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 3000, balance_due: 3000, status: 'overdue', due_date: '2025-01-01',
      });
      await testDb('payment_plans').insert({
        id: 1, invoice_id: 1, customer_id: 1,
        num_installments: 1, installment_amount: 3000, status: 'active',
      });

      const res = await request(app)
        .patch('/api/v1/payment-plans/1/installments/999/pay')
        .set(authHeader());
      expect(res.status).toBe(404);
    });

    it('returns 400 when installment already paid', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 3000, balance_due: 3000, status: 'overdue', due_date: '2025-01-01',
      });
      await testDb('payment_plans').insert({
        id: 1, invoice_id: 1, customer_id: 1,
        num_installments: 1, installment_amount: 3000, status: 'active',
      });
      await testDb('installments').insert({
        id: 1, payment_plan_id: 1, installment_number: 1,
        amount: 3000, due_date: '2025-02-01', status: 'paid',
        payment_link: 'link1', paid_at: '2025-02-01',
      });

      const res = await request(app)
        .patch('/api/v1/payment-plans/1/installments/1/pay')
        .set(authHeader());
      expect(res.status).toBe(400);
    });
  });
});
