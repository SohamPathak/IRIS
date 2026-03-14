import db from '../db.js';

/**
 * Quick Summary Generator — Template-based natural language summary of merchant financial health.
 *
 * Generates a concise (<200 word) plain business language summary including:
 * - Collection performance trend (Req 14.2)
 * - Refund trend (Req 14.2)
 * - Top 3 risk customers (Req 14.2)
 * - Active threats (Req 14.2)
 * - Recommended next actions (Req 14.2)
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */

/**
 * Fetches collection trend data for a merchant.
 * Compares paid vs overdue invoices and computes collection rate.
 */
async function getCollectionTrend(merchantId) {
  const counts = await db('invoices')
    .where({ merchant_id: merchantId })
    .select(
      db.raw("SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid"),
      db.raw("SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue"),
      db.raw("SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending"),
      db.raw('COUNT(*) as total'),
    )
    .first();

  const paid = counts?.paid || 0;
  const overdue = counts?.overdue || 0;
  const total = counts?.total || 0;
  const collectionRate = total > 0 ? Math.round((paid / total) * 100) : 0;

  return { paid, overdue, total, collectionRate };
}

/**
 * Fetches refund trend data for a merchant from the last 30 days.
 */
async function getRefundTrend(merchantId) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString();

  const result = await db('transactions')
    .where({ merchant_id: merchantId, type: 'outgoing' })
    .where('created_at', '>=', cutoff)
    .select(
      db.raw('COUNT(*) as refund_count'),
      db.raw('COALESCE(SUM(amount), 0) as total_refunds'),
    )
    .first();

  return {
    refundCount: result?.refund_count || 0,
    totalRefunds: result?.total_refunds || 0,
  };
}

/**
 * Fetches top 3 highest-risk customers for a merchant.
 */
async function getTopRiskCustomers(merchantId) {
  return db('customers')
    .where({ merchant_id: merchantId })
    .orderBy('risk_score', 'desc')
    .limit(3)
    .select('name', 'risk_score', 'risk_category');
}

/**
 * Fetches active threats for a merchant.
 */
async function getActiveThreats(merchantId) {
  return db('threats')
    .where({ merchant_id: merchantId, status: 'active' })
    .select('threat_type', 'severity', 'description');
}

/**
 * Generates 2-3 recommended actions based on current data.
 */
function buildRecommendations(collectionTrend, refundTrend, threats, topRiskCustomers) {
  const actions = [];

  if (collectionTrend.overdue > 0) {
    actions.push(`Follow up on ${collectionTrend.overdue} overdue invoice${collectionTrend.overdue > 1 ? 's' : ''} to improve collections.`);
  }

  if (refundTrend.refundCount > 0) {
    actions.push('Review recent refund requests for recurring issues.');
  }

  const highRisk = topRiskCustomers.filter((c) => c.risk_category === 'high');
  if (highRisk.length > 0) {
    actions.push(`Prioritize outreach to ${highRisk.length} high-risk customer${highRisk.length > 1 ? 's' : ''}.`);
  }

  if (threats.length > 0) {
    const critical = threats.filter((t) => t.severity === 'critical' || t.severity === 'high');
    if (critical.length > 0) {
      actions.push(`Address ${critical.length} high-priority threat alert${critical.length > 1 ? 's' : ''}.`);
    }
  }

  // Ensure at least 2 actions
  if (actions.length === 0) {
    actions.push('Continue monitoring cash flow and collection performance.');
    actions.push('Review customer risk scores for any changes.');
  } else if (actions.length === 1) {
    actions.push('Continue monitoring overall financial health.');
  }

  return actions.slice(0, 3);
}

/**
 * Formats an INR amount for display.
 */
function formatINR(amount) {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

/**
 * Generates a concise (<200 word) plain language summary of a merchant's financial health.
 *
 * @param {number} merchantId
 * @returns {Promise<{ summary: string, wordCount: number, sections: object }>}
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */
export async function generateSummary(merchantId) {
  if (!merchantId) {
    throw new Error('merchantId is required');
  }

  const [collectionTrend, refundTrend, topRiskCustomers, activeThreats] = await Promise.all([
    getCollectionTrend(merchantId),
    getRefundTrend(merchantId),
    getTopRiskCustomers(merchantId),
    getActiveThreats(merchantId),
  ]);

  const recommendations = buildRecommendations(collectionTrend, refundTrend, activeThreats, topRiskCustomers);

  // Build template-based summary
  const parts = [];

  // Collection trend
  parts.push(
    `Your collection rate is ${collectionTrend.collectionRate}% with ${collectionTrend.paid} paid and ${collectionTrend.overdue} overdue out of ${collectionTrend.total} invoices.`,
  );

  // Refund trend
  if (refundTrend.refundCount > 0) {
    parts.push(
      `In the last 30 days, ${refundTrend.refundCount} refund${refundTrend.refundCount > 1 ? 's were' : ' was'} processed totaling ${formatINR(refundTrend.totalRefunds)}.`,
    );
  } else {
    parts.push('No refunds were processed in the last 30 days.');
  }

  // Top risk customers
  if (topRiskCustomers.length > 0) {
    const names = topRiskCustomers.map((c) => `${c.name} (${c.risk_category} risk)`);
    parts.push(`Top risk customers: ${names.join(', ')}.`);
  } else {
    parts.push('No customers currently flagged for risk.');
  }

  // Active threats
  if (activeThreats.length > 0) {
    const threatSummaries = activeThreats.map((t) => `${t.severity} ${t.threat_type.replace(/_/g, ' ')}`);
    parts.push(`Active threats: ${threatSummaries.join(', ')}.`);
  } else {
    parts.push('No active threats detected.');
  }

  // Recommended actions
  parts.push(`Recommended actions: ${recommendations.join(' ')}`);

  const summary = parts.join(' ');
  const wordCount = summary.split(/\s+/).filter(Boolean).length;

  return {
    summary,
    wordCount,
    sections: {
      collectionTrend,
      refundTrend,
      topRiskCustomers,
      activeThreats,
      recommendations,
    },
  };
}
