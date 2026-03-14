import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import knex from 'knex';

let testDb;
let generateSummary;

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

  // Seed base data
  await testDb('merchants').insert([
    { id: 1, name: 'Test Merchant', email: 'merchant@test.com', business_type: 'retail', api_key: 'test-key' },
  ]);
  await testDb('customers').insert([
    { id: 1, merchant_id: 1, name: 'Customer A', email: 'a@test.com', phone: '9876543210', risk_score: 80, risk_category: 'high' },
    { id: 2, merchant_id: 1, name: 'Customer B', email: 'b@test.com', phone: '9876543211', risk_score: 55, risk_category: 'medium' },
    { id: 3, merchant_id: 1, name: 'Customer C', email: 'c@test.com', phone: '9876543212', risk_score: 20, risk_category: 'low' },
  ]);

  // Mock db module
  vi.doMock('../../../src/db.js', () => ({ default: testDb }));

  const mod = await import('../../../src/engines/summaryGenerator.js');
  generateSummary = mod.generateSummary;
});

afterAll(async () => {
  await testDb.destroy();
});

beforeEach(async () => {
  await testDb('threats').del();
  await testDb('transactions').del();
  await testDb('invoices').del();
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

// ==================== generateSummary ====================
describe('generateSummary', () => {
  it('should throw when merchantId is not provided', async () => {
    await expect(generateSummary()).rejects.toThrow('merchantId is required');
  });

  it('should return a summary under 200 words', async () => {
    await testDb('invoices').insert([
      { merchant_id: 1, customer_id: 1, amount: 10000, balance_due: 0, status: 'paid', due_date: daysAgo(10), paid_at: daysAgo(5) },
      { merchant_id: 1, customer_id: 2, amount: 5000, balance_due: 5000, status: 'overdue', due_date: daysAgo(15) },
      { merchant_id: 1, customer_id: 3, amount: 8000, balance_due: 8000, status: 'pending', due_date: daysFromNow(10) },
    ]);

    const result = await generateSummary(1);
    expect(result.wordCount).toBeLessThan(200);
  });

  it('should include all 5 required sections in the summary text', async () => {
    await testDb('invoices').insert([
      { merchant_id: 1, customer_id: 1, amount: 10000, balance_due: 0, status: 'paid', due_date: daysAgo(10), paid_at: daysAgo(5) },
      { merchant_id: 1, customer_id: 2, amount: 5000, balance_due: 5000, status: 'overdue', due_date: daysAgo(15) },
    ]);
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'outgoing', amount: 2000, created_at: daysAgo(5) },
    ]);
    await testDb('threats').insert([
      { merchant_id: 1, threat_type: 'high_refund_ratio', severity: 'medium', description: 'Refund ratio elevated', recommended_actions: '["Review refunds"]', status: 'active' },
    ]);

    const result = await generateSummary(1);
    const summary = result.summary.toLowerCase();

    // Collection trend
    expect(summary).toMatch(/collection rate|paid|overdue/);
    // Refund trend
    expect(summary).toMatch(/refund/);
    // Top risk customers
    expect(summary).toMatch(/risk/);
    // Active threats
    expect(summary).toMatch(/threat/);
    // Recommended actions
    expect(summary).toMatch(/recommended actions/);
  });

  it('should return structured sections data', async () => {
    await testDb('invoices').insert([
      { merchant_id: 1, customer_id: 1, amount: 10000, balance_due: 0, status: 'paid', due_date: daysAgo(10), paid_at: daysAgo(5) },
    ]);

    const result = await generateSummary(1);
    expect(result.sections).toBeDefined();
    expect(result.sections.collectionTrend).toBeDefined();
    expect(result.sections.refundTrend).toBeDefined();
    expect(result.sections.topRiskCustomers).toBeDefined();
    expect(result.sections.activeThreats).toBeDefined();
    expect(result.sections.recommendations).toBeDefined();
  });

  it('should compute correct collection rate', async () => {
    await testDb('invoices').insert([
      { merchant_id: 1, customer_id: 1, amount: 10000, balance_due: 0, status: 'paid', due_date: daysAgo(10), paid_at: daysAgo(5) },
      { merchant_id: 1, customer_id: 2, amount: 5000, balance_due: 5000, status: 'overdue', due_date: daysAgo(15) },
      { merchant_id: 1, customer_id: 3, amount: 8000, balance_due: 8000, status: 'pending', due_date: daysFromNow(10) },
      { merchant_id: 1, customer_id: 1, amount: 3000, balance_due: 0, status: 'paid', due_date: daysAgo(20), paid_at: daysAgo(18) },
    ]);

    const result = await generateSummary(1);
    // 2 paid out of 4 total = 50%
    expect(result.sections.collectionTrend.collectionRate).toBe(50);
    expect(result.sections.collectionTrend.paid).toBe(2);
    expect(result.sections.collectionTrend.overdue).toBe(1);
    expect(result.sections.collectionTrend.total).toBe(4);
  });

  it('should count refunds from last 30 days only', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'outgoing', amount: 2000, created_at: daysAgo(5) },
      { merchant_id: 1, type: 'outgoing', amount: 3000, created_at: daysAgo(10) },
      { merchant_id: 1, type: 'outgoing', amount: 9000, created_at: daysAgo(60) }, // outside 30-day window
    ]);

    const result = await generateSummary(1);
    expect(result.sections.refundTrend.refundCount).toBe(2);
    expect(result.sections.refundTrend.totalRefunds).toBe(5000);
  });

  it('should return top 3 risk customers sorted by risk score', async () => {
    const result = await generateSummary(1);
    const customers = result.sections.topRiskCustomers;
    expect(customers).toHaveLength(3);
    expect(customers[0].name).toBe('Customer A'); // risk_score 80
    expect(customers[1].name).toBe('Customer B'); // risk_score 55
    expect(customers[2].name).toBe('Customer C'); // risk_score 20
  });

  it('should include active threats only', async () => {
    await testDb('threats').insert([
      { merchant_id: 1, threat_type: 'high_refund_ratio', severity: 'medium', description: 'Active threat', recommended_actions: '[]', status: 'active' },
      { merchant_id: 1, threat_type: 'slow_collections', severity: 'low', description: 'Resolved threat', recommended_actions: '[]', status: 'resolved' },
    ]);

    const result = await generateSummary(1);
    expect(result.sections.activeThreats).toHaveLength(1);
    expect(result.sections.activeThreats[0].threat_type).toBe('high_refund_ratio');
  });

  it('should handle merchant with no data gracefully', async () => {
    const result = await generateSummary(1);
    expect(result.summary).toBeTruthy();
    expect(result.wordCount).toBeLessThan(200);
    expect(result.sections.collectionTrend.total).toBe(0);
    expect(result.sections.refundTrend.refundCount).toBe(0);
  });

  it('should generate at least 2 recommended actions', async () => {
    const result = await generateSummary(1);
    expect(result.sections.recommendations.length).toBeGreaterThanOrEqual(2);
  });

  it('should write summary in plain business language (no code/technical jargon)', async () => {
    await testDb('invoices').insert([
      { merchant_id: 1, customer_id: 1, amount: 10000, balance_due: 0, status: 'paid', due_date: daysAgo(10), paid_at: daysAgo(5) },
      { merchant_id: 1, customer_id: 2, amount: 5000, balance_due: 5000, status: 'overdue', due_date: daysAgo(15) },
    ]);

    const result = await generateSummary(1);
    // Should not contain technical terms
    expect(result.summary).not.toMatch(/SELECT|INSERT|NULL|undefined|NaN|function|async/);
    // Should contain readable language
    expect(result.summary).toMatch(/collection rate|paid|overdue|Recommended actions/);
  });

  it('should format amounts in INR', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'outgoing', amount: 15000, created_at: daysAgo(5) },
    ]);

    const result = await generateSummary(1);
    expect(result.summary).toMatch(/₹/);
  });

  it('should handle large data sets and still stay under 200 words', async () => {
    // Insert many invoices
    const invoices = [];
    for (let i = 0; i < 50; i++) {
      invoices.push({
        merchant_id: 1,
        customer_id: ((i % 3) + 1),
        amount: 1000 + i * 100,
        balance_due: i % 3 === 0 ? 0 : 1000 + i * 100,
        status: i % 3 === 0 ? 'paid' : i % 3 === 1 ? 'overdue' : 'pending',
        due_date: i % 3 === 1 ? daysAgo(10) : daysFromNow(10),
        paid_at: i % 3 === 0 ? daysAgo(2) : null,
      });
    }
    await testDb('invoices').insert(invoices);

    // Insert many threats
    for (let i = 0; i < 5; i++) {
      await testDb('threats').insert({
        merchant_id: 1,
        threat_type: `threat_type_${i}`,
        severity: i % 2 === 0 ? 'high' : 'medium',
        description: `Threat description ${i}`,
        recommended_actions: '[]',
        status: 'active',
      });
    }

    const result = await generateSummary(1);
    expect(result.wordCount).toBeLessThan(200);
  });
});
