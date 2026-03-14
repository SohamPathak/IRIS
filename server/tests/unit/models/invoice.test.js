import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import knex from 'knex';

let testDb;
let create, findById, findAll, updateStatus, recordPartialPayment, recordFullPayment;

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

  // Create tables
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

  await testDb.schema.createTable('invoice_status_history', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id').notNullable().references('id').inTable('invoices');
    t.text('old_status');
    t.text('new_status').notNullable();
    t.text('changed_at').notNullable().defaultTo(testDb.fn.now());
    t.text('reason');
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

  // Dynamic import after mock is set up
  const mod = await import('../../../src/models/invoice.js');
  create = mod.create;
  findById = mod.findById;
  findAll = mod.findAll;
  updateStatus = mod.updateStatus;
  recordPartialPayment = mod.recordPartialPayment;
  recordFullPayment = mod.recordFullPayment;
});

afterAll(async () => {
  await testDb.destroy();
});

beforeEach(async () => {
  await testDb('invoice_status_history').del();
  await testDb('invoice_line_items').del();
  await testDb('invoices').del();
});

function makeInvoiceData(overrides = {}) {
  return {
    merchant_id: 1,
    customer_id: 1,
    amount: 10000,
    due_date: '2025-03-15',
    line_items: [
      { description: 'Widget A', quantity: 2, unit_price: 3000 },
      { description: 'Widget B', quantity: 1, unit_price: 4000 },
    ],
    ...overrides,
  };
}

describe('Invoice Model', () => {
  // ─── create ───
  describe('create', () => {
    it('creates an invoice with correct fields', async () => {
      const invoice = await create(makeInvoiceData());
      expect(invoice.id).toBeDefined();
      expect(invoice.merchant_id).toBe(1);
      expect(invoice.customer_id).toBe(1);
      expect(invoice.amount).toBe(10000);
      expect(invoice.balance_due).toBe(10000);
      expect(invoice.status).toBe('pending');
      expect(invoice.due_date).toBe('2025-03-15');
      expect(invoice.paid_at).toBeNull();
    });

    it('creates line items with computed totals', async () => {
      const invoice = await create(makeInvoiceData());
      expect(invoice.line_items).toHaveLength(2);
      expect(invoice.line_items[0].description).toBe('Widget A');
      expect(invoice.line_items[0].quantity).toBe(2);
      expect(invoice.line_items[0].unit_price).toBe(3000);
      expect(invoice.line_items[0].total).toBe(6000);
      expect(invoice.line_items[1].total).toBe(4000);
    });

    it('records initial status history entry', async () => {
      const invoice = await create(makeInvoiceData());
      const history = await testDb('invoice_status_history')
        .where({ invoice_id: invoice.id });
      expect(history).toHaveLength(1);
      expect(history[0].old_status).toBeNull();
      expect(history[0].new_status).toBe('pending');
      expect(history[0].reason).toBe('Invoice created');
    });

    it('creates invoice with no line items', async () => {
      const invoice = await create(makeInvoiceData({ line_items: [] }));
      expect(invoice.id).toBeDefined();
      expect(invoice.line_items).toHaveLength(0);
    });

    it('sets balance_due equal to amount on creation', async () => {
      const invoice = await create(makeInvoiceData({ amount: 5500 }));
      expect(invoice.balance_due).toBe(5500);
    });
  });

  // ─── findById ───
  describe('findById', () => {
    it('returns invoice with line items and status history', async () => {
      const created = await create(makeInvoiceData());
      const found = await findById(created.id);
      expect(found).not.toBeNull();
      expect(found.id).toBe(created.id);
      expect(found.amount).toBe(10000);
      expect(found.line_items).toHaveLength(2);
      expect(found.status_history).toHaveLength(1);
    });

    it('returns null for non-existent invoice', async () => {
      const found = await findById(99999);
      expect(found).toBeNull();
    });
  });

  // ─── findAll ───
  describe('findAll', () => {
    it('returns all invoices when no filters', async () => {
      await create(makeInvoiceData());
      await create(makeInvoiceData({ amount: 5000 }));
      const invoices = await findAll();
      expect(invoices).toHaveLength(2);
    });

    it('filters by status', async () => {
      const inv = await create(makeInvoiceData());
      await create(makeInvoiceData({ amount: 2000 }));
      await updateStatus(inv.id, 'overdue', 'Past due');
      const overdue = await findAll({ status: 'overdue' });
      expect(overdue).toHaveLength(1);
      expect(overdue[0].id).toBe(inv.id);
    });

    it('filters by merchant_id', async () => {
      await create(makeInvoiceData());
      const invoices = await findAll({ merchant_id: 1 });
      expect(invoices).toHaveLength(1);
      const empty = await findAll({ merchant_id: 999 });
      expect(empty).toHaveLength(0);
    });

    it('filters by customer_id', async () => {
      await create(makeInvoiceData());
      const invoices = await findAll({ customer_id: 1 });
      expect(invoices).toHaveLength(1);
    });

    it('filters by date range', async () => {
      await create(makeInvoiceData({ due_date: '2025-01-01' }));
      await create(makeInvoiceData({ due_date: '2025-06-01' }));
      const filtered = await findAll({ date_from: '2025-05-01', date_to: '2025-07-01' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].due_date).toBe('2025-06-01');
    });

    it('returns empty array when no matches', async () => {
      const invoices = await findAll({ status: 'paid' });
      expect(invoices).toHaveLength(0);
    });
  });

  // ─── updateStatus ───
  describe('updateStatus', () => {
    it('updates status and records history', async () => {
      const inv = await create(makeInvoiceData());
      const updated = await updateStatus(inv.id, 'overdue', 'Past due date');
      expect(updated.status).toBe('overdue');
      const history = await testDb('invoice_status_history')
        .where({ invoice_id: inv.id }).orderBy('id');
      expect(history).toHaveLength(2);
      expect(history[1].old_status).toBe('pending');
      expect(history[1].new_status).toBe('overdue');
      expect(history[1].reason).toBe('Past due date');
    });

    it('throws on invalid status', async () => {
      const inv = await create(makeInvoiceData());
      await expect(updateStatus(inv.id, 'invalid')).rejects.toThrow('Invalid status');
    });

    it('throws on non-existent invoice', async () => {
      await expect(updateStatus(99999, 'paid')).rejects.toThrow('not found');
    });

    it('tracks multiple status transitions', async () => {
      const inv = await create(makeInvoiceData());
      await updateStatus(inv.id, 'overdue', 'Past due');
      await updateStatus(inv.id, 'paid', 'Payment received');
      const history = await testDb('invoice_status_history')
        .where({ invoice_id: inv.id }).orderBy('id');
      expect(history).toHaveLength(3);
      expect(history[0].new_status).toBe('pending');
      expect(history[1].new_status).toBe('overdue');
      expect(history[2].new_status).toBe('paid');
    });
  });

  // ─── recordPartialPayment ───
  describe('recordPartialPayment', () => {
    it('reduces balance_due and sets status to partial', async () => {
      const inv = await create(makeInvoiceData({ amount: 10000 }));
      const updated = await recordPartialPayment(inv.id, 3000);
      expect(updated.balance_due).toBe(7000);
      expect(updated.status).toBe('partial');
    });

    it('records status transition in history', async () => {
      const inv = await create(makeInvoiceData({ amount: 10000 }));
      await recordPartialPayment(inv.id, 2000);
      const history = await testDb('invoice_status_history')
        .where({ invoice_id: inv.id }).orderBy('id');
      expect(history).toHaveLength(2);
      expect(history[1].old_status).toBe('pending');
      expect(history[1].new_status).toBe('partial');
      expect(history[1].reason).toContain('2000');
    });

    it('allows multiple partial payments', async () => {
      const inv = await create(makeInvoiceData({ amount: 10000 }));
      await recordPartialPayment(inv.id, 3000);
      const updated = await recordPartialPayment(inv.id, 2000);
      expect(updated.balance_due).toBe(5000);
      expect(updated.status).toBe('partial');
    });

    it('throws when amount is zero', async () => {
      const inv = await create(makeInvoiceData());
      await expect(recordPartialPayment(inv.id, 0)).rejects.toThrow('greater than 0');
    });

    it('throws when amount is negative', async () => {
      const inv = await create(makeInvoiceData());
      await expect(recordPartialPayment(inv.id, -100)).rejects.toThrow('greater than 0');
    });

    it('throws when amount equals balance_due', async () => {
      const inv = await create(makeInvoiceData({ amount: 5000 }));
      await expect(recordPartialPayment(inv.id, 5000)).rejects.toThrow('Use recordFullPayment');
    });

    it('throws when amount exceeds balance_due', async () => {
      const inv = await create(makeInvoiceData({ amount: 5000 }));
      await expect(recordPartialPayment(inv.id, 6000)).rejects.toThrow('Use recordFullPayment');
    });

    it('throws for non-existent invoice', async () => {
      await expect(recordPartialPayment(99999, 100)).rejects.toThrow('not found');
    });
  });

  // ─── recordFullPayment ───
  describe('recordFullPayment', () => {
    it('sets balance_due to 0 and status to paid', async () => {
      const inv = await create(makeInvoiceData({ amount: 8000 }));
      const updated = await recordFullPayment(inv.id);
      expect(updated.balance_due).toBe(0);
      expect(updated.status).toBe('paid');
      expect(updated.paid_at).toBeDefined();
      expect(updated.paid_at).not.toBeNull();
    });

    it('records status transition in history', async () => {
      const inv = await create(makeInvoiceData());
      await recordFullPayment(inv.id);
      const history = await testDb('invoice_status_history')
        .where({ invoice_id: inv.id }).orderBy('id');
      expect(history).toHaveLength(2);
      expect(history[1].old_status).toBe('pending');
      expect(history[1].new_status).toBe('paid');
      expect(history[1].reason).toBe('Full payment received');
    });

    it('works on a partially paid invoice', async () => {
      const inv = await create(makeInvoiceData({ amount: 10000 }));
      await recordPartialPayment(inv.id, 4000);
      const updated = await recordFullPayment(inv.id);
      expect(updated.balance_due).toBe(0);
      expect(updated.status).toBe('paid');
    });

    it('throws for non-existent invoice', async () => {
      await expect(recordFullPayment(99999)).rejects.toThrow('not found');
    });
  });
});
