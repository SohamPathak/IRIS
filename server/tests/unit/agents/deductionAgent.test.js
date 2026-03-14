import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import knex from 'knex';

let testDb;
let createDispute, verifyClaim, resolveDispute, processRefund, reEvaluate;

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

  await testDb.schema.createTable('invoice_line_items', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id').notNullable().references('id').inTable('invoices');
    t.text('description').notNullable();
    t.integer('quantity').notNullable().defaultTo(1);
    t.real('unit_price').notNullable();
    t.real('total').notNullable();
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

  // Mock db and pinelabsService, then import the agent
  vi.doMock('../../../src/db.js', () => ({ default: testDb }));
  vi.doMock('../../../src/services/pinelabsService.js', () => ({
    default: {
      processRefund: vi.fn(async (ref, amount) => ({
        refundRef: `MOCK-REFUND-${Date.now()}`,
        amount,
        status: 'processed',
      })),
    },
  }));

  const agent = await import('../../../src/agents/deductionAgent.js');
  createDispute = agent.createDispute;
  verifyClaim = agent.verifyClaim;
  resolveDispute = agent.resolveDispute;
  processRefund = agent.processRefund;
  reEvaluate = agent.reEvaluate;
});

afterAll(async () => {
  await testDb.destroy();
  vi.restoreAllMocks();
});

// Seed a merchant, customer, and invoice before each test
const MERCHANT_ID = 1;
const CUSTOMER_ID = 1;
let invoiceId;

beforeEach(async () => {
  // Clear all tables in reverse dependency order
  await testDb('action_logs').del();
  await testDb('transactions').del();
  await testDb('disputes').del();
  await testDb('policy_rules').del();
  await testDb('invoice_line_items').del();
  await testDb('invoices').del();
  await testDb('customers').del();
  await testDb('merchants').del();

  // Seed base data
  await testDb('merchants').insert({
    id: MERCHANT_ID,
    name: 'Test Merchant',
    email: 'merchant@test.com',
    business_type: 'D2C',
    api_key: 'test-key',
  });

  await testDb('customers').insert({
    id: CUSTOMER_ID,
    merchant_id: MERCHANT_ID,
    name: 'Test Customer',
    email: 'customer@test.com',
    phone: '9876543210',
  });

  const [inv] = await testDb('invoices')
    .insert({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      amount: 5000,
      balance_due: 5000,
      status: 'paid',
      due_date: '2024-01-15',
      paid_at: '2024-01-10',
    })
    .returning('*');
  invoiceId = inv.id;

  // Add line items for verification
  await testDb('invoice_line_items').insert({
    invoice_id: invoiceId,
    description: 'Widget A',
    quantity: 2,
    unit_price: 2500,
    total: 5000,
  });
});

// ─── createDispute ───────────────────────────────────────────────────────────

describe('createDispute', () => {
  it('creates a dispute record with correct fields', async () => {
    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });

    expect(dispute).toBeDefined();
    expect(dispute.id).toBeDefined();
    expect(dispute.merchant_id).toBe(MERCHANT_ID);
    expect(dispute.customer_id).toBe(CUSTOMER_ID);
    expect(dispute.invoice_id).toBe(invoiceId);
    expect(dispute.claim_details).toBe('Product arrived damaged, requesting full refund');
    expect(dispute.status).toBe('open');
  });

  it('logs the action in action_logs', async () => {
    await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Wrong item received, need replacement',
    });

    const logs = await testDb('action_logs')
      .where({ agent_type: 'deduction', decision_type: 'create_dispute' });
    expect(logs.length).toBe(1);
    expect(logs[0].reasoning).toContain('dispute');
  });

  it('throws on missing required fields', async () => {
    await expect(createDispute({ merchant_id: MERCHANT_ID }))
      .rejects.toThrow('Missing required dispute fields');
  });

  it('throws if invoice does not exist', async () => {
    await expect(createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: 99999,
      claim_details: 'Some claim details here',
    })).rejects.toThrow('Invoice with ID 99999 not found');
  });
});

// ─── verifyClaim ─────────────────────────────────────────────────────────────

describe('verifyClaim', () => {
  it('verifies a valid claim successfully', async () => {
    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });

    const result = await verifyClaim(dispute.id);

    expect(result.verificationStatus).toBe('verified');
    expect(result.missingInfo).toHaveLength(0);

    // Check DB was updated
    const updated = await testDb('disputes').where({ id: dispute.id }).first();
    expect(updated.status).toBe('verifying');
    expect(updated.verification_status).toBe('verified');
  });

  it('sets needs_info when claim details are too short', async () => {
    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Short',  // Less than 10 chars — but createDispute stores it
    });

    // Manually update to short claim (createDispute requires it non-empty)
    await testDb('disputes').where({ id: dispute.id }).update({ claim_details: 'Short' });

    const result = await verifyClaim(dispute.id);

    expect(result.verificationStatus).toBe('needs_info');
    expect(result.missingInfo).toContain('Claim details are insufficient — please provide more detail');
  });

  it('sets needs_info when no line items exist', async () => {
    // Create invoice without line items
    const [bareInvoice] = await testDb('invoices')
      .insert({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        amount: 1000,
        balance_due: 1000,
        status: 'paid',
        due_date: '2024-02-01',
        paid_at: '2024-01-28',
      })
      .returning('*');

    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: bareInvoice.id,
      claim_details: 'Product never delivered to my address',
    });

    const result = await verifyClaim(dispute.id);

    expect(result.verificationStatus).toBe('needs_info');
    expect(result.missingInfo).toContain('No order line items found for verification');
  });

  it('throws if dispute does not exist', async () => {
    await expect(verifyClaim(99999)).rejects.toThrow('Dispute with ID 99999 not found');
  });

  it('logs verification action', async () => {
    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });

    await verifyClaim(dispute.id);

    const logs = await testDb('action_logs')
      .where({ agent_type: 'deduction', decision_type: 'verify_claim' });
    expect(logs.length).toBe(1);
    expect(logs[0].reasoning).toBeTruthy();
  });
});

// ─── resolveDispute ──────────────────────────────────────────────────────────

describe('resolveDispute', () => {
  it('auto-approves full refund when amount is within threshold', async () => {
    // Add refund threshold policy: auto-approve under ₹10000
    await testDb('policy_rules').insert({
      merchant_id: MERCHANT_ID,
      name: 'Auto-approve small refunds',
      condition_type: 'refund_threshold',
      condition_value: JSON.stringify({ amount: 10000 }),
      action_type: 'auto_approve',
      action_value: JSON.stringify({}),
      is_active: 1,
    });

    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });
    await verifyClaim(dispute.id);

    const result = await resolveDispute(dispute.id);

    expect(result.resolutionType).toBe('full_refund');
    expect(result.refundAmount).toBe(5000);
    expect(result.appliedRules.length).toBeGreaterThan(0);

    // Check dispute is resolved in DB
    const updated = await testDb('disputes').where({ id: dispute.id }).first();
    expect(updated.status).toBe('resolved');
    expect(updated.resolution_type).toBe('full_refund');
    expect(updated.resolved_at).toBeTruthy();
  });

  it('applies partial refund when amount exceeds threshold', async () => {
    // Add refund threshold policy: auto-approve under ₹2000
    await testDb('policy_rules').insert({
      merchant_id: MERCHANT_ID,
      name: 'Auto-approve small refunds',
      condition_type: 'refund_threshold',
      condition_value: JSON.stringify({ amount: 2000 }),
      action_type: 'auto_approve',
      action_value: JSON.stringify({}),
      is_active: 1,
    });

    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });
    await verifyClaim(dispute.id);

    const result = await resolveDispute(dispute.id);

    expect(result.resolutionType).toBe('partial_refund');
    expect(result.refundAmount).toBe(2500); // 50% of 5000
  });

  it('defaults to full refund when no policy rules exist', async () => {
    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });
    await verifyClaim(dispute.id);

    const result = await resolveDispute(dispute.id);

    expect(result.resolutionType).toBe('full_refund');
    expect(result.refundAmount).toBe(5000);
  });

  it('throws if dispute is not verified', async () => {
    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });

    await expect(resolveDispute(dispute.id))
      .rejects.toThrow('not verified');
  });

  it('logs resolution and merchant notification', async () => {
    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });
    await verifyClaim(dispute.id);
    await resolveDispute(dispute.id);

    const resolutionLogs = await testDb('action_logs')
      .where({ agent_type: 'deduction', decision_type: 'resolve_dispute' });
    expect(resolutionLogs.length).toBe(1);
    expect(resolutionLogs[0].policy_rules_applied).toBeTruthy();

    const notificationLogs = await testDb('action_logs')
      .where({ agent_type: 'deduction', decision_type: 'merchant_notification' });
    expect(notificationLogs.length).toBe(1);
  });

  it('records outgoing transaction for refund', async () => {
    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });
    await verifyClaim(dispute.id);
    await resolveDispute(dispute.id);

    const txns = await testDb('transactions')
      .where({ reference_type: 'dispute', type: 'outgoing' });
    expect(txns.length).toBe(1);
    expect(txns[0].amount).toBe(5000);
    expect(txns[0].pine_labs_ref).toMatch(/^MOCK-REFUND-/);
  });
});

// ─── processRefund ───────────────────────────────────────────────────────────

describe('processRefund', () => {
  it('processes refund and records transaction', async () => {
    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });

    const result = await processRefund(dispute.id, 3000);

    expect(result.refundRef).toMatch(/^MOCK-REFUND-/);
    expect(result.amount).toBe(3000);
    expect(result.transaction).toBeDefined();
    expect(result.transaction.type).toBe('outgoing');
    expect(result.transaction.amount).toBe(3000);
  });

  it('throws on invalid amount', async () => {
    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });

    await expect(processRefund(dispute.id, -100))
      .rejects.toThrow('Refund amount must be a positive number');
    await expect(processRefund(dispute.id, 0))
      .rejects.toThrow('Refund amount must be a positive number');
  });

  it('throws if dispute does not exist', async () => {
    await expect(processRefund(99999, 1000))
      .rejects.toThrow('Dispute with ID 99999 not found');
  });

  it('logs the refund action', async () => {
    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });

    await processRefund(dispute.id, 2000);

    const logs = await testDb('action_logs')
      .where({ agent_type: 'deduction', decision_type: 'process_refund' });
    expect(logs.length).toBe(1);
    expect(logs[0].reasoning).toContain('2000');
  });
});

// ─── reEvaluate ──────────────────────────────────────────────────────────────

describe('reEvaluate', () => {
  it('reopens, re-verifies, and re-resolves a dispute', async () => {
    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });
    await verifyClaim(dispute.id);
    await resolveDispute(dispute.id);

    // Re-evaluate with new info
    const result = await reEvaluate(dispute.id, {
      claim_details: 'Product was completely shattered on arrival, photos attached as evidence',
    });

    expect(result.verificationResult.verificationStatus).toBe('verified');
    expect(result.resolutionResult).toBeDefined();
    expect(result.resolutionResult.resolutionType).toBeTruthy();

    // Check dispute was reopened then resolved again
    const updated = await testDb('disputes').where({ id: dispute.id }).first();
    expect(updated.status).toBe('resolved');
    expect(updated.claim_details).toBe('Product was completely shattered on arrival, photos attached as evidence');
  });

  it('throws if no new info provided', async () => {
    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });

    await expect(reEvaluate(dispute.id, {}))
      .rejects.toThrow('New information must include claim_details');
  });

  it('throws if dispute does not exist', async () => {
    await expect(reEvaluate(99999, { claim_details: 'new info here' }))
      .rejects.toThrow('Dispute with ID 99999 not found');
  });

  it('logs re-evaluation action', async () => {
    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: invoiceId,
      claim_details: 'Product arrived damaged, requesting full refund',
    });
    await verifyClaim(dispute.id);
    await resolveDispute(dispute.id);

    await reEvaluate(dispute.id, {
      claim_details: 'Updated claim with more details about the damage',
    });

    const logs = await testDb('action_logs')
      .where({ agent_type: 'deduction', decision_type: 're_evaluate_dispute' });
    expect(logs.length).toBe(1);
    expect(logs[0].reasoning).toContain('Reopening');
  });

  it('does not resolve if re-verification fails', async () => {
    // Create invoice without line items
    const [bareInvoice] = await testDb('invoices')
      .insert({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        amount: 1000,
        balance_due: 1000,
        status: 'paid',
        due_date: '2024-02-01',
        paid_at: '2024-01-28',
      })
      .returning('*');

    const dispute = await createDispute({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      invoice_id: bareInvoice.id,
      claim_details: 'Product never delivered to my address',
    });

    const result = await reEvaluate(dispute.id, {
      claim_details: 'Still no delivery, updated claim',
    });

    expect(result.verificationResult.verificationStatus).toBe('needs_info');
    expect(result.resolutionResult).toBeNull();
  });
});
