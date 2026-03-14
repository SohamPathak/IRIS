import db from '../db.js';

const VALID_STATUSES = ['submitted', 'negotiating', 'approved', 'rejected', 'expired'];

export async function create(data) {
  const { buyer_id, commodity_id, merchant_id, requested_quantity, offered_price_per_unit } = data;
  const now = new Date().toISOString();
  const [id] = await db('bids').insert({
    buyer_id, commodity_id, merchant_id,
    requested_quantity, offered_price_per_unit,
    status: 'submitted',
    created_at: now, updated_at: now,
  });
  return getById(id);
}

export async function getById(id) {
  return db('bids')
    .select('bids.*', 'customers.name as buyer_name', 'commodities.name as commodity_name',
      'negotiation_sessions.id as negotiation_session_id')
    .leftJoin('customers', 'bids.buyer_id', 'customers.id')
    .leftJoin('commodities', 'bids.commodity_id', 'commodities.id')
    .leftJoin('negotiation_sessions', 'bids.id', 'negotiation_sessions.bid_id')
    .where('bids.id', id).first();
}

export async function list(filters = {}) {
  const query = db('bids')
    .select('bids.*', 'customers.name as buyer_name', 'commodities.name as commodity_name',
      'negotiation_sessions.id as negotiation_session_id')
    .leftJoin('customers', 'bids.buyer_id', 'customers.id')
    .leftJoin('commodities', 'bids.commodity_id', 'commodities.id')
    .leftJoin('negotiation_sessions', 'bids.id', 'negotiation_sessions.bid_id');
  if (filters.merchant_id) query.where('bids.merchant_id', filters.merchant_id);
  if (filters.status) query.where('bids.status', filters.status);
  if (filters.buyer_id) query.where('bids.buyer_id', filters.buyer_id);
  if (filters.commodity_id) query.where('bids.commodity_id', filters.commodity_id);
  return query.orderBy('bids.created_at', 'desc');
}

export async function updateStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid bid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  await db('bids').where({ id }).update({ status, updated_at: new Date().toISOString() });
  return getById(id);
}
