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
  await testDb('transactions').del();
  await testDb('disputes').del();
  await testDb('policy_rules').del();
  await testDb('invoice_line_items').del();
  await testDb('invoice_status_history').del();
  await testDb('invoices').del();
});

function authHeader() {
  return { 'X-API-Key': API_KEY };
}

describe('Dispute API Routes', () => {
  describe('Authentication', () => {
    it('returns 401 without API key', async () => {
      const res = await request(app).get('/api/v1/disputes');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/disputes', () => {
    it('returns empty array when no disputes exist', async () => {
      const res = await request(app).get('/api/v1/disputes').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns disputes ordered by created_at desc', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 5000, balance_due: 5000, status: 'pending', due_date: '2025-06-01',
      });
      await testDb('disputes').insert([
        { id: 1, merchant_id: 1, customer_id: 1, invoice_id: 1, claim_details: 'Damaged item', status: 'open', created_at: '2025-01-01' },
        { id: 2, merchant_id: 1, customer_id: 1, invoice_id: 1, claim_details: 'Wrong item', status: 'resolved', created_at: '2025-01-02' },
      ]);

      const res = await request(app).get('/api/v1/disputes').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].id).toBe(2); // most recent first
    });

    it('filters by status', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 5000, balance_due: 5000, status: 'pending', due_date: '2025-06-01',
      });
      await testDb('disputes').insert([
        { id: 1, merchant_id: 1, customer_id: 1, invoice_id: 1, claim_details: 'Damaged', status: 'open' },
        { id: 2, merchant_id: 1, customer_id: 1, invoice_id: 1, claim_details: 'Wrong', status: 'resolved' },
      ]);

      const res = await request(app).get('/api/v1/disputes?status=open').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('open');
    });

    it('filters by customer_id', async () => {
      await testDb('customers').insert({
        id: 2, merchant_id: 1, name: 'Customer 2',
        email: 'c2@test.com', phone: '9876543211',
      });
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 5000, balance_due: 5000, status: 'pending', due_date: '2025-06-01',
      });
      await testDb('disputes').insert([
        { id: 1, merchant_id: 1, customer_id: 1, invoice_id: 1, claim_details: 'Damaged', status: 'open' },
        { id: 2, merchant_id: 1, customer_id: 2, invoice_id: 1, claim_details: 'Wrong', status: 'open' },
      ]);

      const res = await request(app).get('/api/v1/disputes?customer_id=1').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].customer_id).toBe(1);
    });

    it('filters by merchant_id', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 5000, balance_due: 5000, status: 'pending', due_date: '2025-06-01',
      });
      await testDb('disputes').insert({
        id: 1, merchant_id: 1, customer_id: 1, invoice_id: 1, claim_details: 'Damaged', status: 'open',
      });

      const res = await request(app).get('/api/v1/disputes?merchant_id=1').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);

      const res2 = await request(app).get('/api/v1/disputes?merchant_id=999').set(authHeader());
      expect(res2.body.data).toHaveLength(0);
    });

    it('returns 400 for invalid status filter', async () => {
      const res = await request(app).get('/api/v1/disputes?status=invalid').set(authHeader());
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/disputes/:id', () => {
    it('returns dispute detail', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 5000, balance_due: 5000, status: 'pending', due_date: '2025-06-01',
      });
      await testDb('disputes').insert({
        id: 1, merchant_id: 1, customer_id: 1, invoice_id: 1,
        claim_details: 'Damaged item received', status: 'open',
      });

      const res = await request(app).get('/api/v1/disputes/1').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(1);
      expect(res.body.data.claim_details).toBe('Damaged item received');
    });

    it('returns 404 for non-existent dispute', async () => {
      const res = await request(app).get('/api/v1/disputes/999').set(authHeader());
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/disputes', () => {
    it('creates a dispute and triggers verification', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 5000, balance_due: 5000, status: 'pending', due_date: '2025-06-01',
      });
      // Add line items so verification passes
      await testDb('invoice_line_items').insert({
        invoice_id: 1, description: 'Widget', quantity: 2, unit_price: 2500, total: 5000,
      });

      const res = await request(app)
        .post('/api/v1/disputes')
        .set(authHeader())
        .send({
          merchant_id: 1,
          customer_id: 1,
          invoice_id: 1,
          claim_details: 'Received damaged items in the shipment',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dispute).toBeDefined();
      expect(res.body.data.dispute.status).toBe('open');
      expect(res.body.data.verification).toBeDefined();
      expect(res.body.data.verification.verificationStatus).toBe('verified');
    });

    it('creates dispute with needs_info when line items missing', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 5000, balance_due: 5000, status: 'pending', due_date: '2025-06-01',
      });

      const res = await request(app)
        .post('/api/v1/disputes')
        .set(authHeader())
        .send({
          merchant_id: 1,
          customer_id: 1,
          invoice_id: 1,
          claim_details: 'Received damaged items in the shipment',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.verification.verificationStatus).toBe('needs_info');
    });

    it('returns 404 for non-existent invoice', async () => {
      const res = await request(app)
        .post('/api/v1/disputes')
        .set(authHeader())
        .send({
          merchant_id: 1,
          customer_id: 1,
          invoice_id: 999,
          claim_details: 'Damaged item received in shipment',
        });

      expect(res.status).toBe(404);
    });

    it('returns 400 when missing required fields', async () => {
      const res = await request(app)
        .post('/api/v1/disputes')
        .set(authHeader())
        .send({ merchant_id: 1 });

      expect(res.status).toBe(400);
    });

    it('logs actions in action_logs', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 5000, balance_due: 5000, status: 'pending', due_date: '2025-06-01',
      });
      await testDb('invoice_line_items').insert({
        invoice_id: 1, description: 'Widget', quantity: 2, unit_price: 2500, total: 5000,
      });

      await request(app)
        .post('/api/v1/disputes')
        .set(authHeader())
        .send({
          merchant_id: 1, customer_id: 1, invoice_id: 1,
          claim_details: 'Received damaged items in the shipment',
        });

      const logs = await testDb('action_logs').where({ agent_type: 'deduction' });
      expect(logs.length).toBeGreaterThanOrEqual(2); // create_dispute + verify_claim
      expect(logs.some(l => l.decision_type === 'create_dispute')).toBe(true);
      expect(logs.some(l => l.decision_type === 'verify_claim')).toBe(true);
    });
  });

  describe('POST /api/v1/disputes/:id/resolve', () => {
    it('resolves a verified dispute', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 500, balance_due: 500, status: 'pending', due_date: '2025-06-01',
      });
      await testDb('disputes').insert({
        id: 1, merchant_id: 1, customer_id: 1, invoice_id: 1,
        claim_details: 'Damaged item', status: 'verifying', verification_status: 'verified',
      });

      const res = await request(app)
        .post('/api/v1/disputes/1/resolve')
        .set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.resolutionType).toBeDefined();
      expect(res.body.data.refundAmount).toBeGreaterThan(0);
    });

    it('auto-approves refund within policy threshold', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 400, balance_due: 400, status: 'pending', due_date: '2025-06-01',
      });
      await testDb('disputes').insert({
        id: 1, merchant_id: 1, customer_id: 1, invoice_id: 1,
        claim_details: 'Damaged item', status: 'verifying', verification_status: 'verified',
      });
      await testDb('policy_rules').insert({
        merchant_id: 1, name: 'Auto refund under 500',
        condition_type: 'refund_threshold',
        condition_value: JSON.stringify({ amount: 500 }),
        action_type: 'auto_approve',
        action_value: JSON.stringify({}),
      });

      const res = await request(app)
        .post('/api/v1/disputes/1/resolve')
        .set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.resolutionType).toBe('full_refund');
      expect(res.body.data.refundAmount).toBe(400);
    });

    it('returns 404 for non-existent dispute', async () => {
      const res = await request(app)
        .post('/api/v1/disputes/999/resolve')
        .set(authHeader());
      expect(res.status).toBe(404);
    });

    it('returns 400 for unverified dispute', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 500, balance_due: 500, status: 'pending', due_date: '2025-06-01',
      });
      await testDb('disputes').insert({
        id: 1, merchant_id: 1, customer_id: 1, invoice_id: 1,
        claim_details: 'Damaged item', status: 'open', verification_status: 'needs_info',
      });

      const res = await request(app)
        .post('/api/v1/disputes/1/resolve')
        .set(authHeader());
      expect(res.status).toBe(400);
    });

    it('records outgoing transaction for refund', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 1000, balance_due: 1000, status: 'pending', due_date: '2025-06-01',
      });
      await testDb('disputes').insert({
        id: 1, merchant_id: 1, customer_id: 1, invoice_id: 1,
        claim_details: 'Damaged item', status: 'verifying', verification_status: 'verified',
      });

      await request(app).post('/api/v1/disputes/1/resolve').set(authHeader());

      const txns = await testDb('transactions').where({ reference_type: 'dispute', reference_id: 1 });
      expect(txns).toHaveLength(1);
      expect(txns[0].type).toBe('outgoing');
      expect(txns[0].amount).toBeGreaterThan(0);
    });
  });

  describe('POST /api/v1/disputes/:id/re-evaluate', () => {
    it('re-evaluates a dispute with new claim details', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 2000, balance_due: 2000, status: 'pending', due_date: '2025-06-01',
      });
      await testDb('invoice_line_items').insert({
        invoice_id: 1, description: 'Widget', quantity: 1, unit_price: 2000, total: 2000,
      });
      await testDb('disputes').insert({
        id: 1, merchant_id: 1, customer_id: 1, invoice_id: 1,
        claim_details: 'Short claim', status: 'resolved',
        verification_status: 'verified', resolution_type: 'rejection',
      });

      const res = await request(app)
        .post('/api/v1/disputes/1/re-evaluate')
        .set(authHeader())
        .send({ claim_details: 'Updated: item was damaged during shipping, photos attached' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verificationResult).toBeDefined();
    });

    it('returns 404 for non-existent dispute', async () => {
      const res = await request(app)
        .post('/api/v1/disputes/999/re-evaluate')
        .set(authHeader())
        .send({ claim_details: 'New info about the issue' });
      expect(res.status).toBe(404);
    });

    it('returns 400 when missing claim_details', async () => {
      await testDb('invoices').insert({
        id: 1, merchant_id: 1, customer_id: 1,
        amount: 2000, balance_due: 2000, status: 'pending', due_date: '2025-06-01',
      });
      await testDb('disputes').insert({
        id: 1, merchant_id: 1, customer_id: 1, invoice_id: 1,
        claim_details: 'Original claim', status: 'resolved',
      });

      const res = await request(app)
        .post('/api/v1/disputes/1/re-evaluate')
        .set(authHeader())
        .send({});
      expect(res.status).toBe(400);
    });
  });
});
