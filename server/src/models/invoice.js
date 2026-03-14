import db from '../db.js';

/**
 * Invoice model — Knex-based CRUD operations for invoices,
 * line items, and status history tracking.
 */

const VALID_STATUSES = ['pending', 'overdue', 'paid', 'partial'];

/**
 * Create a new invoice with line items.
 * Records initial status transition in history.
 * Uses a transaction to ensure atomicity.
 *
 * @param {object} invoiceData - { merchant_id, customer_id, amount, due_date, line_items }
 * @returns {object} The created invoice with line_items
 */
export async function create(invoiceData) {
  const { merchant_id, customer_id, amount, due_date, line_items = [] } = invoiceData;

  return db.transaction(async (trx) => {
    const [invoice] = await trx('invoices')
      .insert({
        merchant_id,
        customer_id,
        amount,
        balance_due: amount,
        status: 'pending',
        due_date,
      })
      .returning('*');

    const insertedLineItems = [];
    for (const item of line_items) {
      const [lineItem] = await trx('invoice_line_items')
        .insert({
          invoice_id: invoice.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.quantity * item.unit_price,
        })
        .returning('*');
      insertedLineItems.push(lineItem);
    }

    // Record initial status transition
    await trx('invoice_status_history').insert({
      invoice_id: invoice.id,
      old_status: null,
      new_status: 'pending',
      reason: 'Invoice created',
    });

    return { ...invoice, line_items: insertedLineItems };
  });
}

/**
 * Find an invoice by ID, including line items and status history.
 *
 * @param {number} id
 * @returns {object|null} Invoice with line_items and status_history, or null
 */
export async function findById(id) {
  const invoice = await db('invoices')
    .select('invoices.*', 'customers.name as customer_name')
    .leftJoin('customers', 'invoices.customer_id', 'customers.id')
    .where('invoices.id', id)
    .first();
  if (!invoice) return null;

  const line_items = await db('invoice_line_items')
    .where({ invoice_id: id })
    .orderBy('id');

  const status_history = await db('invoice_status_history')
    .where({ invoice_id: id })
    .orderBy('changed_at');

  return { ...invoice, line_items, status_history };
}

/**
 * List invoices with optional filters.
 *
 * @param {object} filters - { status, merchant_id, customer_id, date_from, date_to }
 * @returns {Array} List of invoices
 */
export async function findAll(filters = {}) {
  const query = db('invoices')
    .select('invoices.*', 'customers.name as customer_name')
    .leftJoin('customers', 'invoices.customer_id', 'customers.id');

  if (filters.status) {
    query.where('invoices.status', filters.status);
  }
  if (filters.merchant_id) {
    query.where('invoices.merchant_id', filters.merchant_id);
  }
  if (filters.customer_id) {
    query.where('invoices.customer_id', filters.customer_id);
  }
  if (filters.date_from) {
    query.where('invoices.due_date', '>=', filters.date_from);
  }
  if (filters.date_to) {
    query.where('invoices.due_date', '<=', filters.date_to);
  }

  return query.orderBy('invoices.created_at', 'desc');
}

/**
 * Update invoice status and record the transition in history.
 *
 * @param {number} id
 * @param {string} newStatus - One of: pending, overdue, paid, partial
 * @param {string} [reason]
 * @returns {object} Updated invoice
 */
export async function updateStatus(id, newStatus, reason = null) {
  if (!VALID_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}. Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  return db.transaction(async (trx) => {
    const invoice = await trx('invoices').where({ id }).first();
    if (!invoice) {
      throw new Error(`Invoice with ID ${id} not found`);
    }

    const oldStatus = invoice.status;

    await trx('invoices').where({ id }).update({ status: newStatus });

    await trx('invoice_status_history').insert({
      invoice_id: id,
      old_status: oldStatus,
      new_status: newStatus,
      reason,
    });

    return trx('invoices').where({ id }).first();
  });
}

/**
 * Record a partial payment — reduces balance_due, sets status to 'partial'.
 *
 * @param {number} id
 * @param {number} amount - Payment amount (must be > 0 and < balance_due)
 * @returns {object} Updated invoice
 */
export async function recordPartialPayment(id, amount) {
  return db.transaction(async (trx) => {
    const invoice = await trx('invoices').where({ id }).first();
    if (!invoice) {
      throw new Error(`Invoice with ID ${id} not found`);
    }

    if (amount <= 0) {
      throw new Error('Payment amount must be greater than 0');
    }
    if (amount >= invoice.balance_due) {
      throw new Error('Partial payment must be less than balance due. Use recordFullPayment for full payment.');
    }

    const newBalance = invoice.balance_due - amount;
    const oldStatus = invoice.status;
    const newStatus = 'partial';

    await trx('invoices').where({ id }).update({
      balance_due: newBalance,
      status: newStatus,
    });

    await trx('invoice_status_history').insert({
      invoice_id: id,
      old_status: oldStatus,
      new_status: newStatus,
      reason: `Partial payment of ${amount} received`,
    });

    return trx('invoices').where({ id }).first();
  });
}

/**
 * Record a full payment — sets balance_due to 0, status to 'paid', records paid_at.
 *
 * @param {number} id
 * @returns {object} Updated invoice
 */
export async function recordFullPayment(id) {
  return db.transaction(async (trx) => {
    const invoice = await trx('invoices').where({ id }).first();
    if (!invoice) {
      throw new Error(`Invoice with ID ${id} not found`);
    }

    const oldStatus = invoice.status;
    const paidAt = new Date().toISOString();

    await trx('invoices').where({ id }).update({
      balance_due: 0,
      status: 'paid',
      paid_at: paidAt,
    });

    await trx('invoice_status_history').insert({
      invoice_id: id,
      old_status: oldStatus,
      new_status: 'paid',
      reason: 'Full payment received',
    });

    return trx('invoices').where({ id }).first();
  });
}
