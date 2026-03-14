import db from '../db.js';

export async function create(data) {
  const {
    bid_id, buyer_id, commodity_id, merchant_id,
    quantity, agreed_price_per_unit, total_amount,
    payment_method, payment_link, shipping_date, due_date,
  } = data;
  const now = new Date().toISOString();
  const [id] = await db('transaction_records').insert({
    bid_id, buyer_id, commodity_id, merchant_id,
    quantity, agreed_price_per_unit, total_amount,
    payment_method, payment_status: 'pending',
    payment_link, shipping_date, due_date,
    created_at: now,
  });
  return getById(id);
}

export async function getById(id) {
  return db('transaction_records').where({ id }).first();
}

export async function list(filters = {}) {
  const query = db('transaction_records');
  if (filters.merchant_id) query.where('merchant_id', filters.merchant_id);
  if (filters.buyer_id) query.where('buyer_id', filters.buyer_id);
  if (filters.payment_status) query.where('payment_status', filters.payment_status);
  return query.orderBy('created_at', 'desc');
}

export async function updatePaymentStatus(id, status, extra = {}) {
  const updates = { payment_status: status, ...extra };
  if (status === 'paid') updates.completed_at = new Date().toISOString();
  await db('transaction_records').where({ id }).update(updates);
  return getById(id);
}

export async function getByBuyerId(buyerId) {
  return db('transaction_records')
    .where({ buyer_id: buyerId })
    .orderBy('created_at', 'desc');
}
