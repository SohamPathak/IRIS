import db from '../db.js';

export async function create(data) {
  const { transaction_record_id, buyer_id, merchant_id, amount, due_date, payment_link } = data;
  const now = new Date().toISOString();
  const [id] = await db('credit_lines').insert({
    transaction_record_id, buyer_id, merchant_id,
    amount, due_date, status: 'active',
    payment_link, created_at: now,
  });
  return getById(id);
}

export async function getById(id) {
  return db('credit_lines').where({ id }).first();
}

export async function list(filters = {}) {
  const query = db('credit_lines');
  if (filters.merchant_id) query.where('merchant_id', filters.merchant_id);
  if (filters.buyer_id) query.where('buyer_id', filters.buyer_id);
  if (filters.status) query.where('status', filters.status);
  return query.orderBy('due_date', 'asc');
}

export async function updateStatus(id, status, extra = {}) {
  const updates = { status, ...extra };
  if (status === 'paid') updates.paid_at = new Date().toISOString();
  await db('credit_lines').where({ id }).update(updates);
  return getById(id);
}

export async function getByBuyerId(buyerId) {
  return db('credit_lines')
    .where({ buyer_id: buyerId })
    .orderBy('due_date', 'asc');
}

export async function getOverdue() {
  const now = new Date().toISOString();
  return db('credit_lines')
    .where('status', 'active')
    .where('due_date', '<', now);
}
