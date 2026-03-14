import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import knex from 'knex';

let testDb;
let recordTransaction, getNetBalance, getCashFlowTimeline, generatePredictions, checkCashFlowRisk, getCashFlowSummary;

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

  await testDb.schema.createTable('cash_flow_predictions', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants');
    t.text('prediction_date').notNullable();
    t.real('predicted_incoming').notNullable();
    t.real('predicted_outgoing').notNullable();
    t.real('predicted_net').notNullable();
    t.text('generated_at').notNullable().defaultTo(testDb.fn.now());
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

  // Seed FK references
  await testDb('merchants').insert({
    id: 1, name: 'Test Merchant', email: 'merchant@test.com',
    business_type: 'retail', api_key: 'test-key',
  });
  await testDb('customers').insert({
    id: 1, merchant_id: 1, name: 'Test Customer',
    email: 'customer@test.com', phone: '9876543210',
  });

  // Mock db module to return testDb
  vi.doMock('../../../src/db.js', () => ({ default: testDb }));

  // Dynamic import after mocks
  const mod = await import('../../../src/engines/treasuryEngine.js');
  recordTransaction = mod.recordTransaction;
  getNetBalance = mod.getNetBalance;
  getCashFlowTimeline = mod.getCashFlowTimeline;
  generatePredictions = mod.generatePredictions;
  checkCashFlowRisk = mod.checkCashFlowRisk;
  getCashFlowSummary = mod.getCashFlowSummary;
});

afterAll(async () => {
  await testDb.destroy();
});

beforeEach(async () => {
  await testDb('threats').del();
  await testDb('cash_flow_predictions').del();
  await testDb('transactions').del();
  await testDb('invoices').del();
});

// --- Helper ---
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

// ==================== recordTransaction ====================
describe('recordTransaction', () => {
  it('should record an incoming transaction', async () => {
    const tx = await recordTransaction({
      merchant_id: 1,
      type: 'incoming',
      amount: 5000,
      reference_type: 'invoice',
      reference_id: 42,
      pine_labs_ref: 'MOCK-TXN-123',
    });

    expect(tx.id).toBeDefined();
    expect(tx.type).toBe('incoming');
    expect(tx.amount).toBe(5000);
    expect(tx.pine_labs_ref).toBe('MOCK-TXN-123');

    const row = await testDb('transactions').where({ id: tx.id }).first();
    expect(row.type).toBe('incoming');
    expect(row.amount).toBe(5000);
  });

  it('should record an outgoing transaction', async () => {
    const tx = await recordTransaction({
      merchant_id: 1,
      type: 'outgoing',
      amount: 1500,
      reference_type: 'dispute',
      reference_id: 7,
      pine_labs_ref: 'MOCK-REFUND-456',
    });

    expect(tx.type).toBe('outgoing');
    expect(tx.amount).toBe(1500);
    expect(tx.reference_type).toBe('dispute');
  });

  it('should reject missing required fields', async () => {
    await expect(recordTransaction({ type: 'incoming', amount: 100 }))
      .rejects.toThrow('merchant_id, type, and amount are required');
    await expect(recordTransaction({ merchant_id: 1, amount: 100 }))
      .rejects.toThrow('merchant_id, type, and amount are required');
  });

  it('should reject invalid type', async () => {
    await expect(recordTransaction({ merchant_id: 1, type: 'transfer', amount: 100 }))
      .rejects.toThrow('type must be "incoming" or "outgoing"');
  });

  it('should reject non-positive amount', async () => {
    await expect(recordTransaction({ merchant_id: 1, type: 'incoming', amount: 0 }))
      .rejects.toThrow('amount must be a positive number');
    await expect(recordTransaction({ merchant_id: 1, type: 'incoming', amount: -500 }))
      .rejects.toThrow('amount must be a positive number');
  });

  it('should use provided created_at if given', async () => {
    const customDate = '2024-01-15T10:00:00.000Z';
    const tx = await recordTransaction({
      merchant_id: 1, type: 'incoming', amount: 1000, created_at: customDate,
    });
    expect(tx.created_at).toBe(customDate);
  });
});

// ==================== getNetBalance ====================
describe('getNetBalance', () => {
  it('should return zero balances when no transactions exist', async () => {
    const result = await getNetBalance(1);
    expect(result.total_incoming).toBe(0);
    expect(result.total_outgoing).toBe(0);
    expect(result.net_balance).toBe(0);
  });

  it('should compute correct net balance from mixed transactions', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 10000, created_at: daysAgo(5) },
      { merchant_id: 1, type: 'incoming', amount: 5000, created_at: daysAgo(3) },
      { merchant_id: 1, type: 'outgoing', amount: 3000, created_at: daysAgo(2) },
    ]);

    const result = await getNetBalance(1);
    expect(result.total_incoming).toBe(15000);
    expect(result.total_outgoing).toBe(3000);
    expect(result.net_balance).toBe(12000);
  });

  it('should handle negative net balance', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 2000, created_at: daysAgo(2) },
      { merchant_id: 1, type: 'outgoing', amount: 5000, created_at: daysAgo(1) },
    ]);

    const result = await getNetBalance(1);
    expect(result.net_balance).toBe(-3000);
  });
});

// ==================== getCashFlowTimeline ====================
describe('getCashFlowTimeline', () => {
  it('should return transactions with running balance in chronological order', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 10000, created_at: '2024-01-01T10:00:00Z' },
      { merchant_id: 1, type: 'outgoing', amount: 3000, created_at: '2024-01-02T10:00:00Z' },
      { merchant_id: 1, type: 'incoming', amount: 5000, created_at: '2024-01-03T10:00:00Z' },
    ]);

    const timeline = await getCashFlowTimeline(1);
    expect(timeline).toHaveLength(3);
    expect(timeline[0].running_balance).toBe(10000);
    expect(timeline[1].running_balance).toBe(7000);
    expect(timeline[2].running_balance).toBe(12000);
  });

  it('should filter by period and carry forward prior balance', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 10000, created_at: '2024-01-01T10:00:00Z' },
      { merchant_id: 1, type: 'outgoing', amount: 2000, created_at: '2024-01-05T10:00:00Z' },
      { merchant_id: 1, type: 'incoming', amount: 3000, created_at: '2024-01-10T10:00:00Z' },
    ]);

    const timeline = await getCashFlowTimeline(1, {
      startDate: '2024-01-05T00:00:00Z',
      endDate: '2024-01-15T00:00:00Z',
    });

    expect(timeline).toHaveLength(2);
    // Prior balance: 10000 (from Jan 1 incoming)
    // First in range: outgoing 2000 → 10000 - 2000 = 8000
    expect(timeline[0].running_balance).toBe(8000);
    // Second: incoming 3000 → 8000 + 3000 = 11000
    expect(timeline[1].running_balance).toBe(11000);
  });

  it('should return empty array when no transactions exist', async () => {
    const timeline = await getCashFlowTimeline(1);
    expect(timeline).toEqual([]);
  });
});

// ==================== generatePredictions ====================
describe('generatePredictions', () => {
  it('should generate 90 daily predictions', async () => {
    // Add a pending invoice due in 10 days
    await testDb('invoices').insert({
      merchant_id: 1, customer_id: 1, amount: 30000, balance_due: 30000,
      status: 'pending', due_date: daysFromNow(10),
    });

    const predictions = await generatePredictions(1);
    expect(predictions).toHaveLength(90);
    expect(predictions[0].merchant_id).toBe(1);
    expect(predictions[0].prediction_date).toBeDefined();
    expect(predictions[0].predicted_incoming).toBeTypeOf('number');
    expect(predictions[0].predicted_outgoing).toBeTypeOf('number');
    expect(predictions[0].predicted_net).toBeTypeOf('number');
  });

  it('should store predictions in the database', async () => {
    await generatePredictions(1);
    const stored = await testDb('cash_flow_predictions').where({ merchant_id: 1 });
    expect(stored).toHaveLength(90);
  });

  it('should replace old predictions on re-generation', async () => {
    await generatePredictions(1);
    await generatePredictions(1);
    const stored = await testDb('cash_flow_predictions').where({ merchant_id: 1 });
    expect(stored).toHaveLength(90);
  });

  it('should factor in overdue invoices spread over 30 days', async () => {
    await testDb('invoices').insert({
      merchant_id: 1, customer_id: 1, amount: 30000, balance_due: 30000,
      status: 'overdue', due_date: daysAgo(10),
    });

    const predictions = await generatePredictions(1);
    // First 30 days should have some predicted incoming from overdue spread
    const first30 = predictions.slice(0, 30);
    const totalPredictedIncoming = first30.reduce((sum, p) => sum + p.predicted_incoming, 0);
    expect(totalPredictedIncoming).toBeGreaterThan(0);
    // Should roughly equal the overdue balance (within rounding)
    expect(totalPredictedIncoming).toBeCloseTo(30000, -1);
  });

  it('should factor in refund trends for outgoing predictions', async () => {
    // Add historical refunds
    const refunds = [];
    for (let i = 1; i <= 30; i++) {
      refunds.push({
        merchant_id: 1, type: 'outgoing', amount: 1000, created_at: daysAgo(i),
      });
    }
    await testDb('transactions').insert(refunds);

    const predictions = await generatePredictions(1);
    // Each day should have some predicted outgoing based on refund trend
    expect(predictions[0].predicted_outgoing).toBeGreaterThan(0);
  });
});

// ==================== checkCashFlowRisk ====================
describe('checkCashFlowRisk', () => {
  it('should return no risk when balance is healthy', async () => {
    // Large incoming, small outgoing
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 500000, created_at: daysAgo(1) },
    ]);

    // Generate predictions with no pending invoices (low activity)
    await generatePredictions(1);

    const result = await checkCashFlowRisk(1);
    expect(result.atRisk).toBe(false);
    expect(result.riskDate).toBeNull();
    expect(result.threat).toBeNull();
  });

  it('should detect risk when predicted balance goes negative', async () => {
    // Small incoming, large outgoing trend
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 1000, created_at: daysAgo(1) },
    ]);

    // Insert predictions that go negative
    const now = new Date();
    const predictions = [];
    for (let d = 1; d <= 30; d++) {
      const predDate = new Date(now);
      predDate.setDate(predDate.getDate() + d);
      predictions.push({
        merchant_id: 1,
        prediction_date: predDate.toISOString().split('T')[0],
        predicted_incoming: 0,
        predicted_outgoing: 200,
        predicted_net: -200,
        generated_at: now.toISOString(),
      });
    }
    await testDb('cash_flow_predictions').insert(predictions);

    const result = await checkCashFlowRisk(1);
    expect(result.atRisk).toBe(true);
    expect(result.riskDate).toBeDefined();
    expect(result.predictedBalance).toBeLessThan(0);
    expect(result.threat).toBeDefined();
    expect(result.threat.threat_type).toBe('negative_cash_flow');
  });

  it('should create a threat record in the database when at risk', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 100, created_at: daysAgo(1) },
    ]);

    const now = new Date();
    const predictions = [];
    for (let d = 1; d <= 30; d++) {
      const predDate = new Date(now);
      predDate.setDate(predDate.getDate() + d);
      predictions.push({
        merchant_id: 1,
        prediction_date: predDate.toISOString().split('T')[0],
        predicted_incoming: 0,
        predicted_outgoing: 100,
        predicted_net: -100,
        generated_at: now.toISOString(),
      });
    }
    await testDb('cash_flow_predictions').insert(predictions);

    await checkCashFlowRisk(1);
    const threats = await testDb('threats').where({ merchant_id: 1, threat_type: 'negative_cash_flow' });
    expect(threats.length).toBeGreaterThanOrEqual(1);
  });
});

// ==================== getCashFlowSummary ====================
describe('getCashFlowSummary', () => {
  it('should return correct totals for a given period', async () => {
    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 10000, created_at: '2024-03-01T10:00:00Z' },
      { merchant_id: 1, type: 'incoming', amount: 5000, created_at: '2024-03-05T10:00:00Z' },
      { merchant_id: 1, type: 'outgoing', amount: 2000, created_at: '2024-03-10T10:00:00Z' },
      // Outside period
      { merchant_id: 1, type: 'incoming', amount: 99999, created_at: '2024-04-01T10:00:00Z' },
    ]);

    const summary = await getCashFlowSummary(1, '2024-03-01T00:00:00Z', '2024-03-31T23:59:59Z');
    expect(summary.total_incoming).toBe(15000);
    expect(summary.total_outgoing).toBe(2000);
    expect(summary.net_balance).toBe(13000);
    expect(summary.transaction_count).toBe(3);
    expect(summary.period.start).toBe('2024-03-01T00:00:00Z');
    expect(summary.period.end).toBe('2024-03-31T23:59:59Z');
  });

  it('should return zeros when no transactions in period', async () => {
    const summary = await getCashFlowSummary(1, '2024-01-01T00:00:00Z', '2024-01-31T23:59:59Z');
    expect(summary.total_incoming).toBe(0);
    expect(summary.total_outgoing).toBe(0);
    expect(summary.net_balance).toBe(0);
    expect(summary.transaction_count).toBe(0);
  });

  it('should reject missing parameters', async () => {
    await expect(getCashFlowSummary(null, '2024-01-01', '2024-01-31'))
      .rejects.toThrow('merchantId, startDate, and endDate are required');
    await expect(getCashFlowSummary(1, null, '2024-01-31'))
      .rejects.toThrow('merchantId, startDate, and endDate are required');
    await expect(getCashFlowSummary(1, '2024-01-01', null))
      .rejects.toThrow('merchantId, startDate, and endDate are required');
  });

  it('should only include transactions for the specified merchant', async () => {
    // Insert a second merchant
    await testDb('merchants').insert({
      id: 2, name: 'Other Merchant', email: 'other@test.com',
      business_type: 'service', api_key: 'other-key',
    });

    await testDb('transactions').insert([
      { merchant_id: 1, type: 'incoming', amount: 5000, created_at: '2024-03-01T10:00:00Z' },
      { merchant_id: 2, type: 'incoming', amount: 8000, created_at: '2024-03-01T10:00:00Z' },
    ]);

    const summary = await getCashFlowSummary(1, '2024-03-01T00:00:00Z', '2024-03-31T23:59:59Z');
    expect(summary.total_incoming).toBe(5000);
    expect(summary.transaction_count).toBe(1);
  });
});
