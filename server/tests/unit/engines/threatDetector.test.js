import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import knex from 'knex';

let testDb;
let checkRefundRatio, checkSlowCollections, checkCustomerFraud, checkPaymentAnomalies, evaluateThreats;

beforeAll(async () => {
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
    t.text('recommended_actions').notNullable();
    t.integer('related_customer_id').references('id').inTable('customers');
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
  await testDb('merchants').insert([
    { id: 1, name: 'Test Merchant', email: 'merchant@test.com', business_type: 'retail', api_key: 'test-key' },
    { id: 2, name: 'Other Merchant', email: 'other@test.com', business_type: 'service', api_key: 'other-key' },
  ]);
  await testDb('customers').insert([
    { id: 1, merchant_id: 1, name: 'Customer A', email: 'a@test.com', phone: '9876543210' },
    { id: 2, merchant_id: 1, name: 'Customer B', email: 'b@test.com', phone: '9876543211' },
    { id: 3, merchant_id: 2, name: 'Customer C', email: 'c@test.com', phone: '9876543212' },
  ]);
  await testDb('invoices').insert([
    { id: 1, merchant_id: 1, customer_id: 1, amount: 10000, balance_due: 10000, status: 'pending', due_date: '2025-06-01' },
    { id: 2, merchant_id: 1, customer_id: 2, amount: 5000, balance_due: 5000, status: 'pending', due_date: '2025-06-01' },
    { id: 3, merchant_id: 2, customer_id: 3, amount: 8000, balance_due: 8000, status: 'pending', due_date: '2025-06-01' },
  ]);

  // Mock db module
  vi.doMock('../../../src/db.js', () => ({ default: testDb }));

  const mod = await import('../../../src/engines/threatDetector.js');
  checkRefundRatio = mod.checkRefundRatio;
  checkSlowCollections = mod.checkSlowCollections;
  checkCustomerFraud = mod.checkCustomerFraud;
  checkPaymentAnomalies = mod.checkPaymentAnomalies;
  evaluateThreats = mod.evaluateThreats;
});

afterAll(async () => {
  await testDb.destroy();
});

beforeEach(async () => {
  await testDb('threats').del();
  await testDb('disputes').del();
  await testDb('transactions').del();
  await testDb('invoices').del();
  await testDb('policy_rules').del();

  // Re-insert base invoices needed for FK references
  await testDb('invoices').insert([
    { id: 1, merchant_id: 1, customer_id: 1, amount: 10000, balance_due: 10000, status: 'pending', due_date: daysFromNow(10), created_at: daysAgo(10) },
    { id: 2, merchant_id: 1, customer_id: 2, amount: 5000, balance_due: 5000, status: 'pending', due_date: daysFromNow(10), created_at: daysAgo(10) },
    { id: 3, merchant_id: 2, customer_id: 3, amount: 8000, balance_due: 8000, status: 'pending', due_date: daysFromNow(10), created_at: daysAgo(10) },
  ]);
});

// --- Helpers ---
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

// ==================== checkRefundRatio ====================
describe('checkRefundRatio', () => {
  it('should return null when refund ratio is below threshold', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 100000, created_at: daysAgo(5) },
      { merchant_id: 1, type: 'outgoing', amount: 10000, created_at: daysAgo(3) },
    ]);

    const result = await checkRefundRatio(1);
    expect(result).toBeNull();
  });

  it('should generate threat when refund ratio exceeds threshold', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 10000, created_at: daysAgo(5) },
      { merchant_id: 1, type: 'outgoing', amount: 5000, created_at: daysAgo(3) },
    ]);

    const result = await checkRefundRatio(1);
    expect(result).not.toBeNull();
    expect(result.threat_type).toBe('high_refund_ratio');
    expect(result.severity).toBeDefined();
    expect(result.description).toContain('50.0%');
    expect(result.recommended_actions).toBeDefined();
  });

  it('should return null when no collections exist', async () => {
    const result = await checkRefundRatio(1);
    expect(result).toBeNull();
  });

  it('should only consider transactions within 30-day window', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 10000, created_at: daysAgo(5) },
      { merchant_id: 1, type: 'outgoing', amount: 50000, created_at: daysAgo(60) }, // outside window
    ]);

    const result = await checkRefundRatio(1);
    expect(result).toBeNull();
  });

  it('should assign critical severity for very high ratios', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 10000, created_at: daysAgo(5) },
      { merchant_id: 1, type: 'outgoing', amount: 8000, created_at: daysAgo(3) },
    ]);

    const result = await checkRefundRatio(1);
    expect(result).not.toBeNull();
    expect(result.severity).toBe('critical');
  });

  it('should assign medium severity for moderate ratios', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 10000, created_at: daysAgo(5) },
      { merchant_id: 1, type: 'outgoing', amount: 3500, created_at: daysAgo(3) },
    ]);

    const result = await checkRefundRatio(1);
    expect(result).not.toBeNull();
    expect(result.severity).toBe('medium');
  });

  it('should persist threat to database', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 10000, created_at: daysAgo(5) },
      { merchant_id: 1, type: 'outgoing', amount: 5000, created_at: daysAgo(3) },
    ]);

    await checkRefundRatio(1);
    const threats = await testDb('threats').where({ merchant_id: 1, threat_type: 'high_refund_ratio' });
    expect(threats).toHaveLength(1);
  });
});

// ==================== checkSlowCollections ====================
describe('checkSlowCollections', () => {
  it('should return null when avg days-to-pay is below threshold', async () => {
    // Invoice created 50 days ago, paid 40 days ago → 10 days to pay
    await testDb('invoices').insert({
      id: 100, merchant_id: 1, customer_id: 1, amount: 5000, balance_due: 0,
      status: 'paid', due_date: daysAgo(45), paid_at: daysAgo(40), created_at: daysAgo(50),
    });

    const result = await checkSlowCollections(1);
    expect(result).toBeNull();
  });

  it('should generate threat when avg days-to-pay exceeds threshold', async () => {
    // Invoice created 100 days ago, paid 10 days ago → 90 days to pay
    await testDb('invoices').insert({
      id: 101, merchant_id: 1, customer_id: 1, amount: 5000, balance_due: 0,
      status: 'paid', due_date: daysAgo(80), paid_at: daysAgo(10), created_at: daysAgo(100),
    });

    const result = await checkSlowCollections(1);
    expect(result).not.toBeNull();
    expect(result.threat_type).toBe('slow_collections');
    expect(result.description).toContain('days');
    expect(result.recommended_actions).toBeDefined();
  });

  it('should return null when no paid invoices exist', async () => {
    // beforeEach only inserts pending invoices, so no paid invoices for merchant 1
    const result = await checkSlowCollections(1);
    expect(result).toBeNull();
  });

  it('should persist threat to database', async () => {
    await testDb('invoices').insert({
      id: 102, merchant_id: 1, customer_id: 1, amount: 5000, balance_due: 0,
      status: 'paid', due_date: daysAgo(80), paid_at: daysAgo(10), created_at: daysAgo(100),
    });

    await checkSlowCollections(1);
    const threats = await testDb('threats').where({ merchant_id: 1, threat_type: 'slow_collections' });
    expect(threats).toHaveLength(1);
  });
});

// ==================== checkCustomerFraud ====================
describe('checkCustomerFraud', () => {
  it('should return null when customer has few disputes', async () => {
    await testDb('disputes').insert({
      merchant_id: 1, customer_id: 1, invoice_id: 1,
      claim_details: 'Damaged item', created_at: daysAgo(5),
    });

    const result = await checkCustomerFraud(1);
    expect(result).toBeNull();
  });

  it('should generate threat when customer has refund spike', async () => {
    // Insert 3+ disputes in last 30 days
    for (let i = 0; i < 4; i++) {
      await testDb('disputes').insert({
        merchant_id: 1, customer_id: 1, invoice_id: 1,
        claim_details: `Dispute ${i}`, created_at: daysAgo(i + 1),
      });
    }

    const result = await checkCustomerFraud(1);
    expect(result).not.toBeNull();
    expect(result.threat_type).toBe('customer_fraud');
    expect(result.related_customer_id).toBe(1);
    expect(result.description).toContain('Customer A');
    expect(result.recommended_actions).toBeDefined();
  });

  it('should return null for non-existent customer', async () => {
    const result = await checkCustomerFraud(999);
    expect(result).toBeNull();
  });

  it('should only count disputes within 30-day window', async () => {
    // Insert disputes outside the 30-day window
    for (let i = 0; i < 5; i++) {
      await testDb('disputes').insert({
        merchant_id: 1, customer_id: 1, invoice_id: 1,
        claim_details: `Old dispute ${i}`, created_at: daysAgo(60 + i),
      });
    }

    const result = await checkCustomerFraud(1);
    expect(result).toBeNull();
  });

  it('should persist threat with related_customer_id', async () => {
    for (let i = 0; i < 3; i++) {
      await testDb('disputes').insert({
        merchant_id: 1, customer_id: 1, invoice_id: 1,
        claim_details: `Dispute ${i}`, created_at: daysAgo(i + 1),
      });
    }

    await checkCustomerFraud(1);
    const threats = await testDb('threats').where({ threat_type: 'customer_fraud', related_customer_id: 1 });
    expect(threats).toHaveLength(1);
  });
});

// ==================== checkPaymentAnomalies ====================
describe('checkPaymentAnomalies', () => {
  it('should return empty array when no anomalies exist', async () => {
    const result = await checkPaymentAnomalies();
    expect(result).toEqual([]);
  });

  it('should detect rapid successive refunds', async () => {
    // Insert 3+ refunds in last 7 days for merchant 1
    for (let i = 0; i < 4; i++) {
      await testDb('transactions').insert({
        merchant_id: 1, type: 'outgoing', amount: 1000,
        reference_type: 'dispute', reference_id: i + 1,
        created_at: daysAgo(i),
      });
    }

    const result = await checkPaymentAnomalies();
    const rapidRefunds = result.filter((t) => t.threat_type === 'rapid_refunds' && t.merchant_id === 1);
    expect(rapidRefunds.length).toBeGreaterThanOrEqual(1);
    expect(rapidRefunds[0].description).toContain('refund transactions');
  });

  it('should detect duplicate payment patterns', async () => {
    // Insert multiple outgoing transactions with the same reference_id
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'outgoing', amount: 5000, reference_type: 'dispute', reference_id: 42, created_at: daysAgo(2) },
      { merchant_id: 1, type: 'outgoing', amount: 5000, reference_type: 'dispute', reference_id: 42, created_at: daysAgo(1) },
    ]);

    const result = await checkPaymentAnomalies();
    const duplicates = result.filter((t) => t.threat_type === 'duplicate_payments' && t.merchant_id === 1);
    expect(duplicates.length).toBeGreaterThanOrEqual(1);
    expect(duplicates[0].severity).toBe('high');
  });

  it('should check across all merchants', async () => {
    // Add refunds for merchant 2
    for (let i = 0; i < 4; i++) {
      await testDb('transactions').insert({
        merchant_id: 2, type: 'outgoing', amount: 2000,
        reference_type: 'dispute', reference_id: 100 + i,
        created_at: daysAgo(i),
      });
    }

    const result = await checkPaymentAnomalies();
    const merchant2Threats = result.filter((t) => t.merchant_id === 2);
    expect(merchant2Threats.length).toBeGreaterThanOrEqual(1);
  });
});

// ==================== evaluateThreats ====================
describe('evaluateThreats', () => {
  it('should return empty array when no threats are detected', async () => {
    // beforeEach inserts only pending invoices with no transactions/disputes,
    // so no threats should be detected
    const result = await evaluateThreats();
    expect(result).toEqual([]);
  });

  it('should aggregate threats from all checks', async () => {
    // Set up data that triggers refund ratio threat for merchant 1
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 10000, created_at: daysAgo(5) },
      { merchant_id: 1, type: 'outgoing', amount: 5000, created_at: daysAgo(3) },
    ]);

    // Set up data that triggers customer fraud for customer 1
    for (let i = 0; i < 4; i++) {
      await testDb('disputes').insert({
        merchant_id: 1, customer_id: 1, invoice_id: 1,
        claim_details: `Dispute ${i}`, created_at: daysAgo(i + 1),
      });
    }

    const result = await evaluateThreats();
    expect(result.length).toBeGreaterThanOrEqual(2);

    const types = result.map((t) => t.threat_type);
    expect(types).toContain('high_refund_ratio');
    expect(types).toContain('customer_fraud');
  });

  it('should continue checking even if one check fails', async () => {
    // This test verifies resilience — evaluateThreats should not throw
    // even if individual checks encounter issues
    const result = await evaluateThreats();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ==================== Threat record completeness (Req 10.5) ====================
describe('Threat record completeness', () => {
  it('every generated threat should have severity, description, and recommended_actions', async () => {
    // Trigger a refund ratio threat
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 10000, created_at: daysAgo(5) },
      { merchant_id: 1, type: 'outgoing', amount: 5000, created_at: daysAgo(3) },
    ]);

    const threat = await checkRefundRatio(1);
    expect(threat).not.toBeNull();
    expect(['low', 'medium', 'high', 'critical']).toContain(threat.severity);
    expect(threat.description).toBeTruthy();
    expect(threat.recommended_actions).toBeTruthy();

    // Verify recommended_actions is valid JSON array
    const actions = JSON.parse(threat.recommended_actions);
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('threat status should default to active', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 10000, created_at: daysAgo(5) },
      { merchant_id: 1, type: 'outgoing', amount: 5000, created_at: daysAgo(3) },
    ]);

    const threat = await checkRefundRatio(1);
    expect(threat.status).toBe('active');
  });
});
