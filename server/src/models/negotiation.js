import db from '../db.js';

// --- Sessions ---

export async function createSession(data) {
  const { bid_id, buyer_id, merchant_id, system_prompt, context_json } = data;
  const now = new Date().toISOString();
  const [id] = await db('negotiation_sessions').insert({
    bid_id, buyer_id, merchant_id,
    status: 'active',
    system_prompt,
    context_json: typeof context_json === 'string' ? context_json : JSON.stringify(context_json),
    created_at: now, last_activity_at: now,
  });
  return getSessionById(id);
}

export async function getSessionById(id) {
  return db('negotiation_sessions').where({ id }).first();
}

export async function getSessionByBidId(bidId) {
  return db('negotiation_sessions').where({ bid_id: bidId }).first();
}

export async function updateSessionStatus(id, status) {
  await db('negotiation_sessions').where({ id }).update({ status, last_activity_at: new Date().toISOString() });
  return getSessionById(id);
}

export async function updateSessionContext(id, context) {
  const contextStr = typeof context === 'string' ? context : JSON.stringify(context);
  await db('negotiation_sessions').where({ id }).update({ context_json: contextStr, last_activity_at: new Date().toISOString() });
}

export async function touchSession(id) {
  await db('negotiation_sessions').where({ id }).update({ last_activity_at: new Date().toISOString() });
}

export async function getStaleActiveSessions(cutoffISO) {
  return db('negotiation_sessions')
    .where('status', 'active')
    .where('last_activity_at', '<', cutoffISO);
}

// --- Messages ---

export async function addMessage(data) {
  const { session_id, sender, content } = data;
  const now = new Date().toISOString();
  const [id] = await db('negotiation_messages').insert({
    session_id, sender, content, created_at: now,
  });
  await touchSession(session_id);
  return db('negotiation_messages').where({ id }).first();
}

export async function getMessages(sessionId) {
  return db('negotiation_messages')
    .where({ session_id: sessionId })
    .orderBy('created_at', 'asc');
}

export async function getSessionWithMessages(sessionId) {
  const session = await getSessionById(sessionId);
  if (!session) return null;
  const messages = await getMessages(sessionId);
  return { ...session, messages };
}
