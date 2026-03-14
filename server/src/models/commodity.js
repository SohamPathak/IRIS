import db from '../db.js';

export async function create(data) {
  const { merchant_id, name, description, unit, available_quantity, min_price_per_unit, max_price_per_unit } = data;

  if (min_price_per_unit > max_price_per_unit) {
    throw new Error('min_price_per_unit must be <= max_price_per_unit');
  }
  if (available_quantity < 0) {
    throw new Error('available_quantity must be >= 0');
  }

  const now = new Date().toISOString();
  const [id] = await db('commodities').insert({
    merchant_id, name, description, unit,
    available_quantity, min_price_per_unit, max_price_per_unit,
    created_at: now, updated_at: now,
  });
  return getById(id);
}

export async function getById(id) {
  return db('commodities').where({ id }).first();
}

export async function list(filters = {}) {
  const query = db('commodities');
  if (filters.merchant_id) query.where('merchant_id', filters.merchant_id);
  return query.orderBy('name', 'asc');
}

export async function update(id, data) {
  const existing = await getById(id);
  if (!existing) throw new Error('Commodity not found');

  const min = data.min_price_per_unit !== undefined ? data.min_price_per_unit : existing.min_price_per_unit;
  const max = data.max_price_per_unit !== undefined ? data.max_price_per_unit : existing.max_price_per_unit;
  if (min > max) throw new Error('min_price_per_unit must be <= max_price_per_unit');

  const qty = data.available_quantity !== undefined ? data.available_quantity : existing.available_quantity;
  if (qty < 0) throw new Error('available_quantity must be >= 0');

  const updates = { ...data, updated_at: new Date().toISOString() };
  await db('commodities').where({ id }).update(updates);
  return getById(id);
}

export async function decrementQuantity(id, quantity) {
  const commodity = await getById(id);
  if (!commodity) throw new Error('Commodity not found');
  if (commodity.available_quantity < quantity) {
    throw new Error(`Insufficient inventory: available ${commodity.available_quantity}, requested ${quantity}`);
  }
  await db('commodities').where({ id }).update({
    available_quantity: commodity.available_quantity - quantity,
    updated_at: new Date().toISOString(),
  });
  return getById(id);
}
