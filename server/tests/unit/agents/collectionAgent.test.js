import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import knex from 'knex';

let testDb;
let evaluateOverdueInvoices, escalateReminders, sendReminder, recordReminderSuccess, selectReminderStrategy;
let offerPaymentPlan, handleMissedInstallments;
let computeCustomerRiskScore, flagHighRiskAccounts, getPrioritizedCollectionList;

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

  // Mock Pine Labs service — instant, no delay
  vi.doMock('../../../src/services/pinelabsService.js', () => ({
    default: {
      createPaymentLink: async (invoiceId, amount) => ({
        paymentLink: `https://pinelabs.mock/pay/${invoiceId}?amount=${amount}`,
        transactionRef: `MOCK-TXN-${Date.now()}`,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    },
  }));

  // Mock Risk Scoring Service — use real implementation
  vi.doMock('../../../src/services/riskScoringService.js', async () => {
    const { RiskScoringService } = await vi.importActual('../../../src/services/riskScoringService.js');
    const instance = new RiskScoringService();
    return { default: instance, RiskScoringService };
  });

  // Dynamic import after mocks
  const mod = await import('../../../src/agents/collectionAgent.js');
  evaluateOverdueInvoices = mod.evaluateOverdueInvoices;
  escalateReminders = mod.escalateReminders;
  sendReminder = mod.sendReminder;
  recordReminderSuccess = mod.recordReminderSuccess;
  selectReminderStrategy = mod.selectReminderStrategy;
  offerPaymentPlan = mod.offerPaymentPlan;
  handleMissedInstallments = mod.handleMissedInstallments;
  computeCustomerRiskScore = mod.computeCustomerRiskScore;
  flagHighRiskAccounts = mod.flagHighRiskAccounts;
  getPrioritizedCollectionList = mod.getPrioritizedCollectionList;
});

afterAll(async () => {
  await testDb.destroy();
});

beforeEach(async () => {
  await testDb('action_logs').del();
  await testDb('reminders').del();
  await testDb('installments').del();
  await testDb('payment_plans').del();
  await testDb('policy_rules').del();
  await testDb('invoice_status_history').del();
  await testDb('invoices').del();
  await testDb('customer_response_profiles').del();
});

// Helper: insert an invoice directly
async function insertInvoice(overrides = {}) {
  const data = {
    merchant_id: 1,
    customer_id: 1,
    amount: 10000,
    balance_due: 10000,
    status: 'pending',
    due_date: '2025-01-01',
    ...overrides,
  };
  const [invoice] = await testDb('invoices').insert(data).returning('*');
  return invoice;
}

// Helper: days ago ISO string
function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe('Collection Agent', () => {
  // ─── evaluateOverdueInvoices ───
  describe('evaluateOverdueInvoices', () => {
    it('marks pending invoices past due_date as overdue', async () => {
      await insertInvoice({ due_date: daysAgo(5), status: 'pending' });
      await insertInvoice({ due_date: daysAgo(2), status: 'pending' });

      const result = await evaluateOverdueInvoices();
      expect(result.markedOverdue).toBe(2);

      const invoices = await testDb('invoices').select('*');
      expect(invoices.every((inv) => inv.status === 'overdue')).toBe(true);
    });

    it('does not mark future-dated invoices as overdue', async () => {
      await insertInvoice({ due_date: '2099-12-31', status: 'pending' });

      const result = await evaluateOverdueInvoices();
      expect(result.markedOverdue).toBe(0);

      const invoices = await testDb('invoices').select('*');
      expect(invoices[0].status).toBe('pending');
    });

    it('does not re-mark already overdue invoices', async () => {
      await insertInvoice({ due_date: daysAgo(5), status: 'overdue' });

      const result = await evaluateOverdueInvoices();
      expect(result.markedOverdue).toBe(0);
    });

    it('sends a friendly reminder for each newly overdue invoice', async () => {
      await insertInvoice({ due_date: daysAgo(3), status: 'pending' });

      const result = await evaluateOverdueInvoices();
      expect(result.remindersSent).toBe(1);

      const reminders = await testDb('reminders').select('*');
      expect(reminders).toHaveLength(1);
      expect(reminders[0].escalation_level).toBe('friendly');
    });

    it('records status transition in invoice_status_history', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(1), status: 'pending' });

      await evaluateOverdueInvoices();

      const history = await testDb('invoice_status_history')
        .where({ invoice_id: inv.id });
      expect(history).toHaveLength(1);
      expect(history[0].old_status).toBe('pending');
      expect(history[0].new_status).toBe('overdue');
    });

    it('handles zero overdue invoices gracefully', async () => {
      const result = await evaluateOverdueInvoices();
      expect(result.markedOverdue).toBe(0);
      expect(result.remindersSent).toBe(0);
    });
  });

  // ─── sendReminder ───
  describe('sendReminder', () => {
    it('creates a reminder with a payment link', async () => {
      const inv = await insertInvoice({ status: 'overdue' });

      const reminder = await sendReminder(inv.id, 'friendly');
      expect(reminder.invoice_id).toBe(inv.id);
      expect(reminder.customer_id).toBe(1);
      expect(reminder.escalation_level).toBe('friendly');
      expect(reminder.channel).toBe('email');
      expect(reminder.status).toBe('sent');
      expect(reminder.payment_link).toContain('pinelabs.mock/pay/');
      expect(reminder.payment_link).toContain(`amount=${inv.balance_due}`);
    });

    it('logs the action in action_logs', async () => {
      const inv = await insertInvoice({ status: 'overdue' });

      await sendReminder(inv.id, 'firm');

      const logs = await testDb('action_logs').select('*');
      expect(logs).toHaveLength(1);
      expect(logs[0].agent_type).toBe('collection');
      expect(logs[0].decision_type).toBe('send_reminder');
      expect(logs[0].merchant_id).toBe(1);
      expect(logs[0].reasoning).toContain('firm');
      expect(logs[0].reasoning).toContain(`${inv.id}`);

      const inputs = JSON.parse(logs[0].inputs);
      expect(inputs.invoice_id).toBe(inv.id);
      expect(inputs.escalation_level).toBe('firm');
    });

    it('throws on invalid escalation level', async () => {
      const inv = await insertInvoice({ status: 'overdue' });
      await expect(sendReminder(inv.id, 'aggressive')).rejects.toThrow('Invalid escalation level');
    });

    it('throws on non-existent invoice', async () => {
      await expect(sendReminder(99999, 'friendly')).rejects.toThrow('not found');
    });

    it('includes correct invoice amount in payment link', async () => {
      const inv = await insertInvoice({ status: 'overdue', balance_due: 7500 });

      const reminder = await sendReminder(inv.id, 'friendly');
      expect(reminder.payment_link).toContain('amount=7500');
    });
  });

  // ─── escalateReminders ───
  describe('escalateReminders', () => {
    it('escalates friendly to firm after 7 days with no response', async () => {
      const inv = await insertInvoice({ status: 'overdue' });

      // Insert a friendly reminder sent 8 days ago
      await testDb('reminders').insert({
        invoice_id: inv.id,
        customer_id: 1,
        escalation_level: 'friendly',
        channel: 'email',
        payment_link: 'https://pinelabs.mock/pay/1?amount=10000',
        status: 'sent',
        sent_at: daysAgo(8),
      });

      const result = await escalateReminders();
      expect(result.escalated).toBe(1);

      const reminders = await testDb('reminders')
        .where({ invoice_id: inv.id })
        .orderBy('id');
      expect(reminders).toHaveLength(2);
      expect(reminders[1].escalation_level).toBe('firm');
      expect(reminders[1].payment_link).toContain('pinelabs.mock/pay/');
    });

    it('escalates firm to final after 7 days with no response', async () => {
      const inv = await insertInvoice({ status: 'overdue' });

      await testDb('reminders').insert({
        invoice_id: inv.id,
        customer_id: 1,
        escalation_level: 'firm',
        channel: 'email',
        payment_link: 'https://pinelabs.mock/pay/1?amount=10000',
        status: 'sent',
        sent_at: daysAgo(8),
      });

      const result = await escalateReminders();
      expect(result.escalated).toBe(1);

      const reminders = await testDb('reminders')
        .where({ invoice_id: inv.id })
        .orderBy('id');
      expect(reminders).toHaveLength(2);
      expect(reminders[1].escalation_level).toBe('final');
    });

    it('does not escalate reminders sent less than 7 days ago', async () => {
      const inv = await insertInvoice({ status: 'overdue' });

      await testDb('reminders').insert({
        invoice_id: inv.id,
        customer_id: 1,
        escalation_level: 'friendly',
        channel: 'email',
        payment_link: 'https://pinelabs.mock/pay/1?amount=10000',
        status: 'sent',
        sent_at: daysAgo(3),
      });

      const result = await escalateReminders();
      expect(result.escalated).toBe(0);
    });

    it('does not escalate final reminders', async () => {
      const inv = await insertInvoice({ status: 'overdue' });

      await testDb('reminders').insert({
        invoice_id: inv.id,
        customer_id: 1,
        escalation_level: 'final',
        channel: 'email',
        payment_link: 'https://pinelabs.mock/pay/1?amount=10000',
        status: 'sent',
        sent_at: daysAgo(10),
      });

      const result = await escalateReminders();
      expect(result.escalated).toBe(0);
    });

    it('does not escalate reminders that have been responded to', async () => {
      const inv = await insertInvoice({ status: 'overdue' });

      await testDb('reminders').insert({
        invoice_id: inv.id,
        customer_id: 1,
        escalation_level: 'friendly',
        channel: 'email',
        payment_link: 'https://pinelabs.mock/pay/1?amount=10000',
        status: 'sent',
        sent_at: daysAgo(10),
        responded_at: daysAgo(5),
      });

      const result = await escalateReminders();
      expect(result.escalated).toBe(0);
    });

    it('does not create duplicate escalations', async () => {
      const inv = await insertInvoice({ status: 'overdue' });

      // Friendly sent 10 days ago
      await testDb('reminders').insert({
        invoice_id: inv.id,
        customer_id: 1,
        escalation_level: 'friendly',
        channel: 'email',
        payment_link: 'https://pinelabs.mock/pay/1?amount=10000',
        status: 'sent',
        sent_at: daysAgo(10),
      });

      // Firm already exists
      await testDb('reminders').insert({
        invoice_id: inv.id,
        customer_id: 1,
        escalation_level: 'firm',
        channel: 'email',
        payment_link: 'https://pinelabs.mock/pay/1?amount=10000',
        status: 'sent',
        sent_at: daysAgo(2),
      });

      const result = await escalateReminders();
      expect(result.escalated).toBe(0);
    });

    it('handles multiple invoices needing escalation', async () => {
      const inv1 = await insertInvoice({ status: 'overdue', amount: 5000, balance_due: 5000 });
      const inv2 = await insertInvoice({ status: 'overdue', amount: 8000, balance_due: 8000 });

      await testDb('reminders').insert([
        {
          invoice_id: inv1.id, customer_id: 1, escalation_level: 'friendly',
          channel: 'email', payment_link: 'link1', status: 'sent', sent_at: daysAgo(9),
        },
        {
          invoice_id: inv2.id, customer_id: 1, escalation_level: 'friendly',
          channel: 'email', payment_link: 'link2', status: 'sent', sent_at: daysAgo(8),
        },
      ]);

      const result = await escalateReminders();
      expect(result.escalated).toBe(2);

      const firmReminders = await testDb('reminders')
        .where({ escalation_level: 'firm' });
      expect(firmReminders).toHaveLength(2);
    });
  });
});

describe('Adaptive Reminder Strategy', () => {
  // ─── recordReminderSuccess (Req 3.1, 3.3) ───
  describe('recordReminderSuccess', () => {
    it('creates a new profile entry on first success', async () => {
      const profile = await recordReminderSuccess(1, 'friendly', 'email');

      expect(profile.customer_id).toBe(1);
      expect(profile.escalation_level).toBe('friendly');
      expect(profile.channel).toBe('email');
      expect(profile.attempts).toBe(1);
      expect(profile.successes).toBe(1);
      expect(profile.success_rate).toBe(1);
    });

    it('increments attempts and successes on repeated success', async () => {
      await recordReminderSuccess(1, 'firm', 'sms');
      const profile = await recordReminderSuccess(1, 'firm', 'sms');

      expect(profile.attempts).toBe(2);
      expect(profile.successes).toBe(2);
      expect(profile.success_rate).toBe(1);
    });

    it('tracks separate profiles per escalation level and channel', async () => {
      await recordReminderSuccess(1, 'friendly', 'email');
      await recordReminderSuccess(1, 'firm', 'sms');

      const profiles = await testDb('customer_response_profiles')
        .where({ customer_id: 1 });
      expect(profiles).toHaveLength(2);
      expect(profiles.map((p) => p.escalation_level).sort()).toEqual(['firm', 'friendly']);
    });

    it('stores the profile in the database', async () => {
      await recordReminderSuccess(1, 'final', 'whatsapp');

      const rows = await testDb('customer_response_profiles')
        .where({ customer_id: 1, escalation_level: 'final', channel: 'whatsapp' });
      expect(rows).toHaveLength(1);
      expect(rows[0].successes).toBe(1);
    });
  });

  // ─── selectReminderStrategy (Req 3.2) ───
  describe('selectReminderStrategy', () => {
    it('returns defaults when no profile data exists', async () => {
      const strategy = await selectReminderStrategy(1);

      expect(strategy.escalationLevel).toBe('friendly');
      expect(strategy.channel).toBe('email');
    });

    it('selects the channel/level with the highest success rate', async () => {
      // Insert profiles with different success rates
      await testDb('customer_response_profiles').insert([
        { customer_id: 1, escalation_level: 'friendly', channel: 'email', attempts: 10, successes: 3, success_rate: 0.3 },
        { customer_id: 1, escalation_level: 'firm', channel: 'sms', attempts: 5, successes: 4, success_rate: 0.8 },
        { customer_id: 1, escalation_level: 'final', channel: 'whatsapp', attempts: 3, successes: 1, success_rate: 0.33 },
      ]);

      const strategy = await selectReminderStrategy(1);

      expect(strategy.escalationLevel).toBe('firm');
      expect(strategy.channel).toBe('sms');
    });

    it('ignores profiles with zero successes', async () => {
      await testDb('customer_response_profiles').insert([
        { customer_id: 1, escalation_level: 'friendly', channel: 'email', attempts: 5, successes: 0, success_rate: 0 },
        { customer_id: 1, escalation_level: 'firm', channel: 'sms', attempts: 2, successes: 1, success_rate: 0.5 },
      ]);

      const strategy = await selectReminderStrategy(1);

      expect(strategy.escalationLevel).toBe('firm');
      expect(strategy.channel).toBe('sms');
    });

    it('falls back to defaults when all profiles have zero successes', async () => {
      await testDb('customer_response_profiles').insert([
        { customer_id: 1, escalation_level: 'friendly', channel: 'email', attempts: 5, successes: 0, success_rate: 0 },
      ]);

      const strategy = await selectReminderStrategy(1);

      expect(strategy.escalationLevel).toBe('friendly');
      expect(strategy.channel).toBe('email');
    });

    it('returns correct strategy for a specific customer (not another)', async () => {
      // Add a second customer
      const hasCustomer2 = await testDb('customers').where({ id: 2 }).first();
      if (!hasCustomer2) {
        await testDb('customers').insert({
          id: 2, merchant_id: 1, name: 'Customer Two',
          email: 'c2@test.com', phone: '9876543211',
        });
      }

      await testDb('customer_response_profiles').insert([
        { customer_id: 1, escalation_level: 'firm', channel: 'sms', attempts: 5, successes: 4, success_rate: 0.8 },
        { customer_id: 2, escalation_level: 'friendly', channel: 'whatsapp', attempts: 3, successes: 3, success_rate: 1.0 },
      ]);

      const strategy1 = await selectReminderStrategy(1);
      expect(strategy1.escalationLevel).toBe('firm');
      expect(strategy1.channel).toBe('sms');

      const strategy2 = await selectReminderStrategy(2);
      expect(strategy2.escalationLevel).toBe('friendly');
      expect(strategy2.channel).toBe('whatsapp');
    });
  });
});


// Helper: insert an EMI eligibility policy rule
async function insertEmiPolicy(overrides = {}) {
  const data = {
    merchant_id: 1,
    name: 'EMI for overdue > 30 days',
    condition_type: 'emi_eligibility',
    condition_value: JSON.stringify({ overdue_days: 30 }),
    action_type: 'offer_emi',
    action_value: JSON.stringify({ num_installments: 3 }),
    is_active: 1,
    ...overrides,
  };
  const [rule] = await testDb('policy_rules').insert(data).returning('*');
  return rule;
}

describe('Payment Plan Logic', () => {
  // ─── offerPaymentPlan (Req 4.1, 4.2, 4.4) ───
  describe('offerPaymentPlan', () => {
    it('creates a payment plan when invoice is overdue beyond policy threshold', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(45), status: 'overdue', balance_due: 9000 });
      await insertEmiPolicy({ condition_value: JSON.stringify({ overdue_days: 30 }) });

      const result = await offerPaymentPlan(inv.id);

      expect(result.offered).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan.invoice_id).toBe(inv.id);
      expect(result.plan.num_installments).toBe(3);
      expect(result.plan.status).toBe('active');
      expect(result.installments).toHaveLength(3);
    });

    it('generates Pine Labs payment links for each installment', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(45), status: 'overdue', balance_due: 9000 });
      await insertEmiPolicy();

      const result = await offerPaymentPlan(inv.id);

      for (const inst of result.installments) {
        expect(inst.payment_link).toContain('pinelabs.mock/pay/');
        expect(inst.payment_link).toBeTruthy();
      }
    });

    it('calculates installment amounts that sum to balance_due', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(45), status: 'overdue', balance_due: 10000 });
      await insertEmiPolicy({ action_value: JSON.stringify({ num_installments: 3 }) });

      const result = await offerPaymentPlan(inv.id);

      const totalInstallments = result.installments.reduce((sum, i) => sum + i.amount, 0);
      expect(Math.abs(totalInstallments - 10000)).toBeLessThanOrEqual(1);
    });

    it('handles uneven division with remainder on last installment', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(45), status: 'overdue', balance_due: 10001 });
      await insertEmiPolicy({ action_value: JSON.stringify({ num_installments: 3 }) });

      const result = await offerPaymentPlan(inv.id);

      const totalInstallments = result.installments.reduce((sum, i) => sum + i.amount, 0);
      expect(Math.abs(totalInstallments - 10001)).toBeLessThanOrEqual(1);
    });

    it('does not offer plan if invoice is not overdue', async () => {
      const inv = await insertInvoice({ due_date: '2099-12-31', status: 'pending' });
      await insertEmiPolicy();

      const result = await offerPaymentPlan(inv.id);

      expect(result.offered).toBe(false);
      expect(result.reason).toContain('not overdue');
    });

    it('does not offer plan if overdue days do not exceed threshold', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(10), status: 'overdue' });
      await insertEmiPolicy({ condition_value: JSON.stringify({ overdue_days: 30 }) });

      const result = await offerPaymentPlan(inv.id);

      expect(result.offered).toBe(false);
      expect(result.reason).toContain('does not meet EMI threshold');
    });

    it('does not offer plan if no EMI policy rules exist', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(45), status: 'overdue' });

      const result = await offerPaymentPlan(inv.id);

      expect(result.offered).toBe(false);
      expect(result.reason).toContain('No active EMI eligibility policy rules');
    });

    it('does not offer plan if one already exists for the invoice', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(45), status: 'overdue', balance_due: 9000 });
      await insertEmiPolicy();

      // Create first plan
      await offerPaymentPlan(inv.id);

      // Try again
      const result = await offerPaymentPlan(inv.id);

      expect(result.offered).toBe(false);
      expect(result.reason).toContain('already exists');
    });

    it('throws on non-existent invoice', async () => {
      await expect(offerPaymentPlan(99999)).rejects.toThrow('not found');
    });

    it('logs the action in action_logs', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(45), status: 'overdue', balance_due: 9000 });
      await insertEmiPolicy();

      await offerPaymentPlan(inv.id);

      const logs = await testDb('action_logs')
        .where({ decision_type: 'offer_payment_plan' });
      expect(logs).toHaveLength(1);
      expect(logs[0].agent_type).toBe('collection');
      expect(logs[0].reasoning).toContain('overdue');
      expect(logs[0].reasoning).toContain(`${inv.id}`);
    });

    it('uses num_installments from policy action_value', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(45), status: 'overdue', balance_due: 12000 });
      await insertEmiPolicy({ action_value: JSON.stringify({ num_installments: 6 }) });

      const result = await offerPaymentPlan(inv.id);

      expect(result.plan.num_installments).toBe(6);
      expect(result.installments).toHaveLength(6);
    });

    it('assigns sequential installment numbers and due dates', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(45), status: 'overdue', balance_due: 9000 });
      await insertEmiPolicy();

      const result = await offerPaymentPlan(inv.id);

      for (let i = 0; i < result.installments.length; i++) {
        expect(result.installments[i].installment_number).toBe(i + 1);
        expect(result.installments[i].due_date).toBeTruthy();
      }

      // Due dates should be in ascending order
      for (let i = 1; i < result.installments.length; i++) {
        expect(result.installments[i].due_date > result.installments[i - 1].due_date).toBe(true);
      }
    });
  });

  // ─── handleMissedInstallments (Req 4.3) ───
  describe('handleMissedInstallments', () => {
    it('marks overdue installments as missed and sends reminders', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(60), status: 'overdue', balance_due: 9000 });

      // Create a payment plan with a past-due installment
      const [plan] = await testDb('payment_plans').insert({
        invoice_id: inv.id,
        customer_id: 1,
        num_installments: 3,
        installment_amount: 3000,
        status: 'active',
      }).returning('*');

      await testDb('installments').insert({
        payment_plan_id: plan.id,
        installment_number: 1,
        amount: 3000,
        due_date: daysAgo(5),
        status: 'pending',
        payment_link: 'https://pinelabs.mock/pay/old',
      });

      const result = await handleMissedInstallments();

      expect(result.missed).toBe(1);
      expect(result.reminders).toBe(1);

      // Installment should be marked as missed
      const inst = await testDb('installments').where({ payment_plan_id: plan.id }).first();
      expect(inst.status).toBe('missed');

      // A reminder should have been created
      const reminders = await testDb('reminders').where({ invoice_id: inv.id });
      expect(reminders).toHaveLength(1);
      expect(reminders[0].escalation_level).toBe('firm');
      expect(reminders[0].payment_link).toContain('pinelabs.mock/pay/');
    });

    it('flags the payment plan as defaulted', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(60), status: 'overdue', balance_due: 6000 });

      const [plan] = await testDb('payment_plans').insert({
        invoice_id: inv.id,
        customer_id: 1,
        num_installments: 2,
        installment_amount: 3000,
        status: 'active',
      }).returning('*');

      await testDb('installments').insert({
        payment_plan_id: plan.id,
        installment_number: 1,
        amount: 3000,
        due_date: daysAgo(3),
        status: 'pending',
      });

      await handleMissedInstallments();

      const updatedPlan = await testDb('payment_plans').where({ id: plan.id }).first();
      expect(updatedPlan.status).toBe('defaulted');
    });

    it('does not flag already-paid installments', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(60), status: 'overdue', balance_due: 6000 });

      const [plan] = await testDb('payment_plans').insert({
        invoice_id: inv.id,
        customer_id: 1,
        num_installments: 2,
        installment_amount: 3000,
        status: 'active',
      }).returning('*');

      await testDb('installments').insert({
        payment_plan_id: plan.id,
        installment_number: 1,
        amount: 3000,
        due_date: daysAgo(5),
        status: 'paid',
        paid_at: daysAgo(6),
      });

      const result = await handleMissedInstallments();

      expect(result.missed).toBe(0);
      expect(result.reminders).toBe(0);
    });

    it('does not process installments from defaulted plans', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(60), status: 'overdue', balance_due: 6000 });

      const [plan] = await testDb('payment_plans').insert({
        invoice_id: inv.id,
        customer_id: 1,
        num_installments: 2,
        installment_amount: 3000,
        status: 'defaulted',
      }).returning('*');

      await testDb('installments').insert({
        payment_plan_id: plan.id,
        installment_number: 2,
        amount: 3000,
        due_date: daysAgo(3),
        status: 'pending',
      });

      const result = await handleMissedInstallments();

      expect(result.missed).toBe(0);
    });

    it('does not process future installments', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(60), status: 'overdue', balance_due: 6000 });

      const [plan] = await testDb('payment_plans').insert({
        invoice_id: inv.id,
        customer_id: 1,
        num_installments: 2,
        installment_amount: 3000,
        status: 'active',
      }).returning('*');

      await testDb('installments').insert({
        payment_plan_id: plan.id,
        installment_number: 1,
        amount: 3000,
        due_date: '2099-12-31',
        status: 'pending',
      });

      const result = await handleMissedInstallments();

      expect(result.missed).toBe(0);
    });

    it('logs missed installment actions', async () => {
      const inv = await insertInvoice({ due_date: daysAgo(60), status: 'overdue', balance_due: 3000 });

      const [plan] = await testDb('payment_plans').insert({
        invoice_id: inv.id,
        customer_id: 1,
        num_installments: 1,
        installment_amount: 3000,
        status: 'active',
      }).returning('*');

      await testDb('installments').insert({
        payment_plan_id: plan.id,
        installment_number: 1,
        amount: 3000,
        due_date: daysAgo(2),
        status: 'pending',
      });

      await handleMissedInstallments();

      const logs = await testDb('action_logs')
        .where({ decision_type: 'missed_installment' });
      expect(logs).toHaveLength(1);
      expect(logs[0].agent_type).toBe('collection');
      expect(logs[0].reasoning).toContain('not paid');
    });

    it('handles zero missed installments gracefully', async () => {
      const result = await handleMissedInstallments();
      expect(result.missed).toBe(0);
      expect(result.reminders).toBe(0);
    });
  });
});


// Helper: insert a risk threshold policy rule
async function insertRiskThresholdPolicy(overrides = {}) {
  const data = {
    merchant_id: 1,
    name: 'High risk threshold',
    condition_type: 'risk_threshold',
    condition_value: JSON.stringify({ overdue_amount: 10000 }),
    action_type: 'flag_risk',
    action_value: JSON.stringify({}),
    is_active: 1,
    ...overrides,
  };
  const [rule] = await testDb('policy_rules').insert(data).returning('*');
  return rule;
}

// Helper: insert a customer
async function insertCustomer(overrides = {}) {
  const data = {
    merchant_id: 1,
    name: 'Risk Customer',
    email: 'risk@test.com',
    phone: '9876543299',
    risk_score: 50,
    risk_category: 'medium',
    ...overrides,
  };
  const [customer] = await testDb('customers').insert(data).returning('*');
  return customer;
}

describe('High-Risk Flagging', () => {
  // ─── computeCustomerRiskScore (Req 5.2, 5.4) ───
  describe('computeCustomerRiskScore', () => {
    it('computes risk score for a customer with no invoices', async () => {
      const result = await computeCustomerRiskScore(1);

      expect(result.customerId).toBe(1);
      expect(result.riskScore).toBeTypeOf('number');
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(100);
      expect(['low', 'medium', 'high']).toContain(result.riskCategory);
    });

    it('updates the customer record with new risk score and category', async () => {
      await computeCustomerRiskScore(1);

      const customer = await testDb('customers').where({ id: 1 }).first();
      expect(customer.risk_score).toBeTypeOf('number');
      expect(['low', 'medium', 'high']).toContain(customer.risk_category);
    });

    it('increases risk score when customer has late payments', async () => {
      // Insert paid invoices where paid_at > due_date (late)
      await insertInvoice({
        status: 'paid',
        due_date: daysAgo(30),
        paid_at: daysAgo(20),
        created_at: daysAgo(40),
      });
      await insertInvoice({
        status: 'paid',
        due_date: daysAgo(25),
        paid_at: daysAgo(15),
        created_at: daysAgo(35),
      });

      const result = await computeCustomerRiskScore(1);

      // Base 50 + late penalty (2 * 5 = 10) - on-time bonus (0) = 60+
      expect(result.riskScore).toBeGreaterThan(50);
    });

    it('decreases risk score when customer has on-time payments', async () => {
      // Insert paid invoices where paid_at <= due_date (on-time)
      await insertInvoice({
        status: 'paid',
        due_date: daysAgo(10),
        paid_at: daysAgo(15),
        created_at: daysAgo(20),
      });
      await insertInvoice({
        status: 'paid',
        due_date: daysAgo(5),
        paid_at: daysAgo(10),
        created_at: daysAgo(15),
      });

      const result = await computeCustomerRiskScore(1);

      // Base 50 - on-time bonus (2 * 5 = 10) = 40
      expect(result.riskScore).toBeLessThan(50);
    });

    it('increases risk score for active overdue invoices', async () => {
      await insertInvoice({ status: 'overdue', due_date: daysAgo(10) });
      await insertInvoice({ status: 'overdue', due_date: daysAgo(5) });

      const result = await computeCustomerRiskScore(1);

      // Base 50 + overdue penalty (2 * 10 = 20) = 70
      expect(result.riskScore).toBeGreaterThanOrEqual(70);
    });

    it('clamps risk score to [0, 100]', async () => {
      // Many on-time payments to push score low
      for (let i = 0; i < 10; i++) {
        await insertInvoice({
          status: 'paid',
          due_date: daysAgo(1),
          paid_at: daysAgo(5),
          created_at: daysAgo(10),
        });
      }

      const result = await computeCustomerRiskScore(1);
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(100);
    });

    it('throws on non-existent customer', async () => {
      await expect(computeCustomerRiskScore(99999)).rejects.toThrow('not found');
    });

    it('categorizes risk correctly based on score thresholds', async () => {
      // Customer with no invoices gets base score of 50 → medium
      const result = await computeCustomerRiskScore(1);
      expect(result.riskCategory).toBe('medium');
    });
  });

  // ─── flagHighRiskAccounts (Req 5.1, 5.2, 5.3) ───
  describe('flagHighRiskAccounts', () => {
    beforeEach(async () => {
      // Clean up extra customers added by tests (keep id=1)
      await testDb('customers').whereNot({ id: 1 }).del();
    });

    it('flags customers whose overdue amount exceeds threshold', async () => {
      await insertRiskThresholdPolicy({ condition_value: JSON.stringify({ overdue_amount: 5000 }) });
      await insertInvoice({ status: 'overdue', balance_due: 8000 });

      const result = await flagHighRiskAccounts();

      expect(result.evaluated).toBe(1);
      expect(result.flagged).toBe(1);
    });

    it('does not flag customers below the overdue threshold', async () => {
      await insertRiskThresholdPolicy({ condition_value: JSON.stringify({ overdue_amount: 20000 }) });
      await insertInvoice({ status: 'overdue', balance_due: 5000 });

      const result = await flagHighRiskAccounts();

      expect(result.evaluated).toBe(1);
      expect(result.flagged).toBe(0);
    });

    it('does not flag when no risk threshold policy exists', async () => {
      await insertInvoice({ status: 'overdue', balance_due: 50000 });

      const result = await flagHighRiskAccounts();

      expect(result.evaluated).toBe(1);
      expect(result.flagged).toBe(0);
    });

    it('logs flagging action in action_logs', async () => {
      await insertRiskThresholdPolicy({ condition_value: JSON.stringify({ overdue_amount: 1000 }) });
      await insertInvoice({ status: 'overdue', balance_due: 5000 });

      await flagHighRiskAccounts();

      const logs = await testDb('action_logs')
        .where({ decision_type: 'flag_high_risk' });
      expect(logs).toHaveLength(1);
      expect(logs[0].agent_type).toBe('collection');
      expect(logs[0].reasoning).toContain('overdue');
      expect(logs[0].reasoning).toContain('threshold');

      const inputs = JSON.parse(logs[0].inputs);
      expect(inputs.customer_id).toBe(1);
      expect(inputs.total_overdue).toBe(5000);
      expect(inputs.threshold).toBe(1000);
    });

    it('evaluates multiple customers and flags only those exceeding threshold', async () => {
      const cust2 = await insertCustomer({ name: 'Low Risk', email: 'low@test.com', phone: '1111111111' });
      await insertRiskThresholdPolicy({ condition_value: JSON.stringify({ overdue_amount: 10000 }) });

      // Customer 1: overdue 15000 (exceeds threshold)
      await insertInvoice({ customer_id: 1, status: 'overdue', balance_due: 15000 });
      // Customer 2: overdue 5000 (below threshold)
      await insertInvoice({ customer_id: cust2.id, status: 'overdue', balance_due: 5000 });

      const result = await flagHighRiskAccounts();

      expect(result.evaluated).toBe(2);
      expect(result.flagged).toBe(1);
    });

    it('recomputes risk scores during flagging', async () => {
      await insertRiskThresholdPolicy({ condition_value: JSON.stringify({ overdue_amount: 1000 }) });
      await insertInvoice({ status: 'overdue', balance_due: 5000 });

      await flagHighRiskAccounts();

      const customer = await testDb('customers').where({ id: 1 }).first();
      // Score should have been recomputed (overdue invoice adds penalty)
      expect(customer.risk_score).toBeGreaterThan(50);
    });

    it('handles zero customers gracefully', async () => {
      await testDb('customers').del();

      const result = await flagHighRiskAccounts();

      expect(result.evaluated).toBe(0);
      expect(result.flagged).toBe(0);

      // Restore the test customer
      await testDb('customers').insert({
        id: 1, merchant_id: 1, name: 'Test Customer',
        email: 'customer@test.com', phone: '9876543210',
        risk_score: 50, risk_category: 'medium',
      });
    });
  });

  // ─── getPrioritizedCollectionList (Req 12.3) ───
  describe('getPrioritizedCollectionList', () => {
    beforeEach(async () => {
      await testDb('customers').whereNot({ id: 1 }).del();
    });

    it('returns customers with overdue invoices sorted by risk score descending', async () => {
      const cust2 = await insertCustomer({
        name: 'High Risk', email: 'high@test.com', phone: '2222222222',
        risk_score: 80, risk_category: 'high',
      });
      const cust3 = await insertCustomer({
        name: 'Low Risk', email: 'low@test.com', phone: '3333333333',
        risk_score: 20, risk_category: 'low',
      });

      // Update customer 1 risk score
      await testDb('customers').where({ id: 1 }).update({ risk_score: 55 });

      // All three have overdue invoices
      await insertInvoice({ customer_id: 1, status: 'overdue', balance_due: 5000 });
      await insertInvoice({ customer_id: cust2.id, status: 'overdue', balance_due: 10000 });
      await insertInvoice({ customer_id: cust3.id, status: 'overdue', balance_due: 3000 });

      const list = await getPrioritizedCollectionList(1);

      expect(list).toHaveLength(3);
      expect(list[0].id).toBe(cust2.id);
      expect(list[0].risk_score).toBe(80);
      expect(list[1].id).toBe(1);
      expect(list[1].risk_score).toBe(55);
      expect(list[2].id).toBe(cust3.id);
      expect(list[2].risk_score).toBe(20);
    });

    it('excludes customers without overdue invoices', async () => {
      const cust2 = await insertCustomer({
        name: 'No Overdue', email: 'nooverdue@test.com', phone: '4444444444',
        risk_score: 90, risk_category: 'high',
      });

      // Customer 1 has overdue, customer 2 has only paid
      await insertInvoice({ customer_id: 1, status: 'overdue', balance_due: 5000 });
      await insertInvoice({ customer_id: cust2.id, status: 'paid', balance_due: 0 });

      const list = await getPrioritizedCollectionList(1);

      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(1);
    });

    it('includes total_overdue amount for each customer', async () => {
      await insertInvoice({ customer_id: 1, status: 'overdue', balance_due: 5000 });
      await insertInvoice({ customer_id: 1, status: 'overdue', balance_due: 3000 });

      const list = await getPrioritizedCollectionList(1);

      expect(list).toHaveLength(1);
      expect(list[0].total_overdue).toBe(8000);
    });

    it('returns empty array when no customers have overdue invoices', async () => {
      const list = await getPrioritizedCollectionList(1);
      expect(list).toEqual([]);
    });

    it('only returns customers for the specified merchant', async () => {
      // Insert a second merchant
      await testDb('merchants').insert({
        id: 2, name: 'Other Merchant', email: 'other@test.com',
        business_type: 'service', api_key: 'other-key',
      });
      const cust2 = await insertCustomer({
        merchant_id: 2, name: 'Other Customer', email: 'other@cust.com', phone: '5555555555',
        risk_score: 90, risk_category: 'high',
      });

      await insertInvoice({ customer_id: 1, merchant_id: 1, status: 'overdue', balance_due: 5000 });
      await insertInvoice({ customer_id: cust2.id, merchant_id: 2, status: 'overdue', balance_due: 10000 });

      const list = await getPrioritizedCollectionList(1);

      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(1);

      // Clean up
      await testDb('invoices').where({ merchant_id: 2 }).del();
      await testDb('customers').where({ merchant_id: 2 }).del();
      await testDb('merchants').where({ id: 2 }).del();
    });
  });
});
