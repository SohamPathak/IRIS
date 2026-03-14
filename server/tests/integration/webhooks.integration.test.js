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

  // Create all required tables
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
    t.integer('quantity').notNullable();
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
    t.integer('related_customer_id');
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

  await testDb.schema.createTable('cash_flow_predictions', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants');
    t.text('prediction_date').notNullable();
    t.real('predicted_incoming').notNullable();
    t.real('predicted_outgoing').notNullable();
    t.real('predicted_net').notNullable();
    t.text('generated_at').notNullable().defaultTo(testDb.fn.now());
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

  await testDb.schema.createTable('webhook_subscriptions', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants');
    t.text('event_type').notNullable();
    t.text('callback_url').notNullable();
    t.text('api_key');
    t.integer('is_active').notNullable().defaultTo(1);
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
  await testDb('invoices').insert({
    id: 1, merchant_id: 1, customer_id: 1,
    amount: 5000, balance_due: 5000, status: 'pending',
    due_date: '2025-01-15',
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
  await testDb('webhook_subscriptions').del();
  await testDb('transactions').del();
  await testDb('invoice_status_history').del();
  // Reset invoice to original state
  await testDb('invoices').where({ id: 1 }).update({
    status: 'pending', balance_due: 5000, paid_at: null,
  });
});

function authHeader() {
  return { 'X-API-Key': API_KEY };
}

describe('Webhook API Routes', () => {
  describe('Authentication', () => {
    it('returns 401 for subscribe without API key', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/subscribe')
        .send({ merchant_id: 1, event_type: 'payment', callback_url: 'https://example.com/hook' });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 401 for unsubscribe without API key', async () => {
      const res = await request(app).delete('/api/v1/webhooks/1');
      expect(res.status).toBe(401);
    });

    it('allows Pine Labs callback without API key', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/pine-labs/callback')
        .send({ transaction_id: 'TXN-1', invoice_id: 1, amount: 5000, status: 'success' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/v1/webhooks/subscribe', () => {
    it('creates a webhook subscription', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/subscribe')
        .set(authHeader())
        .send({ merchant_id: 1, event_type: 'payment', callback_url: 'https://example.com/hook' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.merchant_id).toBe(1);
      expect(res.body.data.event_type).toBe('payment');
      expect(res.body.data.callback_url).toBe('https://example.com/hook');
      expect(res.body.data.is_active).toBe(1);
    });

    it('stores optional api_key', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/subscribe')
        .set(authHeader())
        .send({
          merchant_id: 1, event_type: 'refund',
          callback_url: 'https://example.com/hook', api_key: 'my-secret',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.api_key).toBe('my-secret');
    });

    it('returns 400 when missing required fields', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/subscribe')
        .set(authHeader())
        .send({ merchant_id: 1 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for invalid event_type', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/subscribe')
        .set(authHeader())
        .send({ merchant_id: 1, event_type: 'invalid', callback_url: 'https://example.com/hook' });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/v1/webhooks/:id', () => {
    it('deletes a webhook subscription', async () => {
      const createRes = await request(app)
        .post('/api/v1/webhooks/subscribe')
        .set(authHeader())
        .send({ merchant_id: 1, event_type: 'payment', callback_url: 'https://example.com/hook' });
      const id = createRes.body.data.id;

      const res = await request(app).delete(`/api/v1/webhooks/${id}`).set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deleted).toBe(true);
      expect(res.body.data.id).toBe(id);

      // Verify it's gone
      const rows = await testDb('webhook_subscriptions').where({ id });
      expect(rows).toHaveLength(0);
    });

    it('returns 404 for non-existent subscription', async () => {
      const res = await request(app).delete('/api/v1/webhooks/999').set(authHeader());
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('WEBHOOK_NOT_FOUND');
    });
  });

  describe('POST /api/v1/webhooks/pine-labs/callback', () => {
    it('updates invoice to paid on success callback', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/pine-labs/callback')
        .send({ transaction_id: 'TXN-123', invoice_id: 1, amount: 5000, status: 'success' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.received).toBe(true);
      expect(res.body.data.invoice_id).toBe(1);
      expect(res.body.data.status).toBe('success');

      // Verify invoice updated
      const invoice = await testDb('invoices').where({ id: 1 }).first();
      expect(invoice.status).toBe('paid');
      expect(invoice.balance_due).toBe(0);
      expect(invoice.paid_at).toBeTruthy();
    });

    it('records a transaction on success callback', async () => {
      await request(app)
        .post('/api/v1/webhooks/pine-labs/callback')
        .send({ transaction_id: 'TXN-456', invoice_id: 1, amount: 5000, status: 'success' });

      const txns = await testDb('transactions').where({ reference_id: 1, reference_type: 'invoice' });
      expect(txns).toHaveLength(1);
      expect(txns[0].type).toBe('incoming');
      expect(txns[0].amount).toBe(5000);
      expect(txns[0].pine_labs_ref).toBe('TXN-456');
      expect(txns[0].merchant_id).toBe(1);
    });

    it('records status history on success callback', async () => {
      await request(app)
        .post('/api/v1/webhooks/pine-labs/callback')
        .send({ transaction_id: 'TXN-789', invoice_id: 1, amount: 5000, status: 'success' });

      const history = await testDb('invoice_status_history').where({ invoice_id: 1 });
      expect(history).toHaveLength(1);
      expect(history[0].old_status).toBe('pending');
      expect(history[0].new_status).toBe('paid');
      expect(history[0].reason).toContain('TXN-789');
    });

    it('does not update invoice on non-success status', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/pine-labs/callback')
        .send({ transaction_id: 'TXN-FAIL', invoice_id: 1, amount: 5000, status: 'failed' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('failed');

      // Invoice should remain pending
      const invoice = await testDb('invoices').where({ id: 1 }).first();
      expect(invoice.status).toBe('pending');
      expect(invoice.balance_due).toBe(5000);
    });

    it('returns 400 for invalid payload', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/pine-labs/callback')
        .send({ invoice_id: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CALLBACK');
    });

    it('returns 404 for non-existent invoice', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/pine-labs/callback')
        .send({ transaction_id: 'TXN-X', invoice_id: 999, amount: 1000, status: 'success' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('INVOICE_NOT_FOUND');
    });
  });
});
