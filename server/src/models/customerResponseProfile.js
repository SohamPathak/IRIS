import db from '../db.js';

/**
 * Customer Response Profiles model.
 * Tracks per-customer success rates for each escalation_level + channel combination.
 * Requirements: 3.1, 3.3
 */

/**
 * Get all response profiles for a customer.
 * @param {number} customerId
 * @returns {Promise<Array>}
 */
export async function getProfilesByCustomer(customerId) {
  return db('customer_response_profiles')
    .where({ customer_id: customerId })
    .select('*');
}

/**
 * Get the profile with the highest success rate for a customer.
 * Returns null if no profiles exist or all have zero successes.
 * @param {number} customerId
 * @returns {Promise<object|null>}
 */
export async function getBestProfile(customerId) {
  const profile = await db('customer_response_profiles')
    .where({ customer_id: customerId })
    .where('successes', '>', 0)
    .orderBy('success_rate', 'desc')
    .first();
  return profile || null;
}

/**
 * Record an attempt and optionally a success for a given customer/level/channel.
 * Upserts the profile row and recalculates success_rate.
 *
 * @param {number} customerId
 * @param {string} escalationLevel - 'friendly' | 'firm' | 'final'
 * @param {string} channel - 'email' | 'sms' | 'whatsapp'
 * @param {boolean} success - whether this attempt led to payment
 * @returns {Promise<object>} The updated profile row
 */
export async function upsertProfile(customerId, escalationLevel, channel, success) {
  const existing = await db('customer_response_profiles')
    .where({ customer_id: customerId, escalation_level: escalationLevel, channel })
    .first();

  if (existing) {
    const newAttempts = existing.attempts + 1;
    const newSuccesses = existing.successes + (success ? 1 : 0);
    const newRate = newSuccesses / newAttempts;

    await db('customer_response_profiles')
      .where({ id: existing.id })
      .update({ attempts: newAttempts, successes: newSuccesses, success_rate: newRate });

    return { ...existing, attempts: newAttempts, successes: newSuccesses, success_rate: newRate };
  }

  const [profile] = await db('customer_response_profiles')
    .insert({
      customer_id: customerId,
      escalation_level: escalationLevel,
      channel,
      attempts: 1,
      successes: success ? 1 : 0,
      success_rate: success ? 1 : 0,
    })
    .returning('*');

  return profile;
}
