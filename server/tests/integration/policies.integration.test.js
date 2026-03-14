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

  // Tables needed by app.js imports (even if not directly used by policy routes)
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
  await testDb('policy_rules').del();
});

function authHeader() {
  return { 'X-API-Key': API_KEY };
}

function validRule(overrides = {}) {
  return {
    merchant_id: 1,
    name: 'Auto refund under 500',
    condition_type: 'refund_threshold',
    condition_value: JSON.stringify({ amount: 500 }),
    action_type: 'auto_approve',
    action_value: JSON.stringify({ approve: true }),
    ...overrides,
  };
}

describe('Policy Editor API Routes', () => {
  describe('Authentication', () => {
    it('returns 401 without API key', async () => {
      const res = await request(app).get('/api/v1/policies');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/policies/templates', () => {
    it('returns rule templates for common scenarios', async () => {
      const res = await request(app).get('/api/v1/policies/templates').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(4);

      const types = res.body.data.map((t) => t.condition_type);
      expect(types).toContain('refund_threshold');
      expect(types).toContain('emi_eligibility');
      expect(types).toContain('reminder_timing');
      expect(types).toContain('risk_threshold');
    });

    it('each template has required fields', async () => {
      const res = await request(app).get('/api/v1/policies/templates').set(authHeader());
      for (const template of res.body.data) {
        expect(template.name).toBeTruthy();
        expect(template.condition_type).toBeTruthy();
        expect(template.condition_value).toBeTruthy();
        expect(template.action_type).toBeTruthy();
        expect(template.action_value).toBeTruthy();
        expect(template.description).toBeTruthy();
      }
    });
  });

  describe('GET /api/v1/policies', () => {
    it('returns empty array when no rules exist', async () => {
      const res = await request(app).get('/api/v1/policies').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns all policy rules ordered by created_at desc', async () => {
      await testDb('policy_rules').insert([
        { merchant_id: 1, name: 'Rule A', condition_type: 'refund_threshold', condition_value: '{}', action_type: 'auto_approve', action_value: '{}', created_at: '2025-01-01' },
        { merchant_id: 1, name: 'Rule B', condition_type: 'emi_eligibility', condition_value: '{}', action_type: 'offer_emi', action_value: '{}', created_at: '2025-01-02' },
      ]);

      const res = await request(app).get('/api/v1/policies').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].name).toBe('Rule B'); // most recent first
    });

    it('filters by merchant_id', async () => {
      await testDb('merchants').insert({ id: 2, name: 'Merchant 2', email: 'm2@test.com', business_type: 'service', api_key: 'key2' });
      await testDb('policy_rules').insert([
        { merchant_id: 1, name: 'Rule A', condition_type: 'refund_threshold', condition_value: '{}', action_type: 'auto_approve', action_value: '{}' },
        { merchant_id: 2, name: 'Rule B', condition_type: 'emi_eligibility', condition_value: '{}', action_type: 'offer_emi', action_value: '{}' },
      ]);

      const res = await request(app).get('/api/v1/policies?merchant_id=1').set(authHeader());
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Rule A');
    });

    it('filters by condition_type', async () => {
      await testDb('policy_rules').insert([
        { merchant_id: 1, name: 'Rule A', condition_type: 'refund_threshold', condition_value: '{}', action_type: 'auto_approve', action_value: '{}' },
        { merchant_id: 1, name: 'Rule B', condition_type: 'emi_eligibility', condition_value: '{}', action_type: 'offer_emi', action_value: '{}' },
      ]);

      const res = await request(app).get('/api/v1/policies?condition_type=refund_threshold').set(authHeader());
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].condition_type).toBe('refund_threshold');
    });

    it('filters by is_active', async () => {
      await testDb('policy_rules').insert([
        { merchant_id: 1, name: 'Active', condition_type: 'refund_threshold', condition_value: '{}', action_type: 'auto_approve', action_value: '{}', is_active: 1 },
        { merchant_id: 1, name: 'Inactive', condition_type: 'emi_eligibility', condition_value: '{}', action_type: 'offer_emi', action_value: '{}', is_active: 0 },
      ]);

      const res = await request(app).get('/api/v1/policies?is_active=1').set(authHeader());
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Active');
    });

    it('returns 400 for invalid condition_type filter', async () => {
      const res = await request(app).get('/api/v1/policies?condition_type=invalid').set(authHeader());
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/policies', () => {
    it('creates a policy rule', async () => {
      const res = await request(app)
        .post('/api/v1/policies')
        .set(authHeader())
        .send(validRule());

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.name).toBe('Auto refund under 500');
      expect(res.body.data.condition_type).toBe('refund_threshold');
      expect(res.body.data.is_active).toBe(1);
    });

    it('returns 400 when missing required fields', async () => {
      const res = await request(app)
        .post('/api/v1/policies')
        .set(authHeader())
        .send({ merchant_id: 1 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for invalid condition_type', async () => {
      const res = await request(app)
        .post('/api/v1/policies')
        .set(authHeader())
        .send(validRule({ condition_type: 'invalid_type' }));

      expect(res.status).toBe(400);
    });

    it('returns 409 when conflicting active rule exists', async () => {
      await request(app).post('/api/v1/policies').set(authHeader()).send(validRule());

      const res = await request(app)
        .post('/api/v1/policies')
        .set(authHeader())
        .send(validRule({ name: 'Another refund rule' }));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('POLICY_CONFLICT');
      expect(res.body.error.details.conflicting_rule_id).toBeDefined();
    });

    it('allows same condition_type for different merchants', async () => {
      await testDb('merchants').insert({ id: 3, name: 'Merchant 3', email: 'm3@test.com', business_type: 'service', api_key: 'key3' });

      await request(app).post('/api/v1/policies').set(authHeader()).send(validRule());
      const res = await request(app)
        .post('/api/v1/policies')
        .set(authHeader())
        .send(validRule({ merchant_id: 3 }));

      expect(res.status).toBe(201);
    });

    it('allows same condition_type if existing rule is inactive', async () => {
      await testDb('policy_rules').insert({
        merchant_id: 1, name: 'Old rule', condition_type: 'refund_threshold',
        condition_value: '{}', action_type: 'auto_approve', action_value: '{}', is_active: 0,
      });

      const res = await request(app)
        .post('/api/v1/policies')
        .set(authHeader())
        .send(validRule());

      expect(res.status).toBe(201);
    });
  });

  describe('PUT /api/v1/policies/:id', () => {
    it('updates a policy rule', async () => {
      const createRes = await request(app).post('/api/v1/policies').set(authHeader()).send(validRule());
      const id = createRes.body.data.id;

      const res = await request(app)
        .put(`/api/v1/policies/${id}`)
        .set(authHeader())
        .send({ name: 'Updated rule name', condition_value: JSON.stringify({ amount: 1000 }) });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Updated rule name');
      expect(res.body.data.condition_value).toBe(JSON.stringify({ amount: 1000 }));
    });

    it('returns 404 for non-existent rule', async () => {
      const res = await request(app)
        .put('/api/v1/policies/999')
        .set(authHeader())
        .send({ name: 'Updated' });

      expect(res.status).toBe(404);
    });

    it('returns 400 when no valid fields provided', async () => {
      const createRes = await request(app).post('/api/v1/policies').set(authHeader()).send(validRule());
      const id = createRes.body.data.id;

      const res = await request(app)
        .put(`/api/v1/policies/${id}`)
        .set(authHeader())
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 409 when update causes conflict', async () => {
      // Create two rules with different condition types
      await request(app).post('/api/v1/policies').set(authHeader()).send(validRule());
      const res2 = await request(app).post('/api/v1/policies').set(authHeader()).send(validRule({ condition_type: 'emi_eligibility', name: 'EMI rule' }));
      const emiId = res2.body.data.id;

      // Try to change the EMI rule's condition_type to refund_threshold (conflict)
      const res = await request(app)
        .put(`/api/v1/policies/${emiId}`)
        .set(authHeader())
        .send({ condition_type: 'refund_threshold' });

      expect(res.status).toBe(409);
    });

    it('allows deactivating a rule', async () => {
      const createRes = await request(app).post('/api/v1/policies').set(authHeader()).send(validRule());
      const id = createRes.body.data.id;

      const res = await request(app)
        .put(`/api/v1/policies/${id}`)
        .set(authHeader())
        .send({ is_active: 0 });

      expect(res.status).toBe(200);
      expect(res.body.data.is_active).toBe(0);
    });

    it('updates updated_at timestamp', async () => {
      const createRes = await request(app).post('/api/v1/policies').set(authHeader()).send(validRule());
      const id = createRes.body.data.id;
      const originalUpdatedAt = createRes.body.data.updated_at;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 10));

      const res = await request(app)
        .put(`/api/v1/policies/${id}`)
        .set(authHeader())
        .send({ name: 'Updated' });

      expect(res.body.data.updated_at).not.toBe(originalUpdatedAt);
    });
  });

  describe('DELETE /api/v1/policies/:id', () => {
    it('deletes a policy rule', async () => {
      const createRes = await request(app).post('/api/v1/policies').set(authHeader()).send(validRule());
      const id = createRes.body.data.id;

      const res = await request(app).delete(`/api/v1/policies/${id}`).set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deleted).toBe(true);
      expect(res.body.data.id).toBe(id);

      // Verify it's gone
      const listRes = await request(app).get('/api/v1/policies').set(authHeader());
      expect(listRes.body.data).toHaveLength(0);
    });

    it('returns 404 for non-existent rule', async () => {
      const res = await request(app).delete('/api/v1/policies/999').set(authHeader());
      expect(res.status).toBe(404);
    });
  });
});
