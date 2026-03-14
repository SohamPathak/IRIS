import db from '../db.js';

/**
 * Threat Detector — Identifies potential financial risks, fraud patterns, and anomalies.
 *
 * Responsibilities:
 * - Detect high refund-to-collection ratio (Req 10.1)
 * - Detect slow collections / increasing days-to-pay (Req 10.2)
 * - Detect customer fraud via refund spikes (Req 10.3)
 * - Detect unusual payment patterns (Req 10.4)
 * - Each threat includes severity, description, recommended actions (Req 10.5)
 */

// Default thresholds (used when no merchant policy rule is configured)
const DEFAULT_REFUND_RATIO_THRESHOLD = 0.3; // 30% refund-to-collection ratio
const DEFAULT_SLOW_COLLECTIONS_DAYS = 45; // avg days-to-pay threshold
const DEFAULT_FRAUD_REFUND_COUNT = 3; // refund requests in 30-day window
const DEFAULT_FAILED_PAYMENT_COUNT = 3; // failed payments threshold
const DEFAULT_RAPID_REFUND_COUNT = 3; // rapid successive refunds in 7 days

/**
 * Fetches a merchant-configured threshold from policy_rules.
 * Falls back to the provided default if no active rule exists.
 */
async function getMerchantThreshold(merchantId, conditionType, defaultValue) {
  const rule = await db('policy_rules')
    .where({ merchant_id: merchantId, condition_type: conditionType, is_active: 1 })
    .first();

  if (rule && rule.condition_value != null) {
    const parsed = parseFloat(rule.condition_value);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

/**
 * Creates a threat record in the database.
 */
async function createThreat(threatData) {
  const record = {
    merchant_id: threatData.merchant_id,
    threat_type: threatData.threat_type,
    severity: threatData.severity,
    description: threatData.description,
    recommended_actions: typeof threatData.recommended_actions === 'string'
      ? threatData.recommended_actions
      : JSON.stringify(threatData.recommended_actions),
    related_customer_id: threatData.related_customer_id || null,
    status: 'active',
    created_at: new Date().toISOString(),
  };

  const [id] = await db('threats').insert(record);
  return { id, ...record };
}

/**
 * Checks the refund-to-collection ratio for a merchant in a rolling 30-day window.
 * Generates a "high_refund_ratio" threat if the ratio exceeds the configured threshold.
 *
 * @param {number} merchantId
 * @returns {Promise<object|null>} The threat record if generated, null otherwise
 * Requirements: 10.1
 */
export async function checkRefundRatio(merchantId) {
  const threshold = await getMerchantThreshold(merchantId, 'refund_threshold', DEFAULT_REFUND_RATIO_THRESHOLD);
  // For refund_threshold policy rules, the condition_value is an amount (e.g. 500 for auto-approve).
  // For ratio detection we use a dedicated default since the policy rule is for a different purpose.
  const ratioThreshold = threshold > 1 ? DEFAULT_REFUND_RATIO_THRESHOLD : threshold;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString();

  const result = await db('transactions')
    .where({ merchant_id: merchantId })
    .where('created_at', '>=', cutoff)
    .select(
      db.raw("SUM(CASE WHEN type = 'incoming' THEN amount ELSE 0 END) as total_collections"),
      db.raw("SUM(CASE WHEN type = 'outgoing' THEN amount ELSE 0 END) as total_refunds"),
    )
    .first();

  const totalCollections = result?.total_collections || 0;
  const totalRefunds = result?.total_refunds || 0;

  // Avoid division by zero — no collections means no meaningful ratio
  if (totalCollections === 0) return null;

  const ratio = totalRefunds / totalCollections;

  if (ratio > ratioThreshold) {
    const severity = ratio > 0.7 ? 'critical' : ratio > 0.5 ? 'high' : 'medium';
    return createThreat({
      merchant_id: merchantId,
      threat_type: 'high_refund_ratio',
      severity,
      description: `Refund-to-collection ratio is ${(ratio * 100).toFixed(1)}% in the last 30 days (threshold: ${(ratioThreshold * 100).toFixed(1)}%). Total collections: ₹${totalCollections.toLocaleString('en-IN')}, total refunds: ₹${totalRefunds.toLocaleString('en-IN')}.`,
      recommended_actions: [
        'Review recent refund requests for patterns',
        'Tighten refund approval policies',
        'Investigate top refund-requesting customers',
      ],
    });
  }

  return null;
}

/**
 * Checks the average days-to-pay trend for a merchant.
 * Generates a "slow_collections" threat if the average exceeds the configured threshold.
 *
 * @param {number} merchantId
 * @returns {Promise<object|null>} The threat record if generated, null otherwise
 * Requirements: 10.2
 */
export async function checkSlowCollections(merchantId) {
  const threshold = await getMerchantThreshold(merchantId, 'risk_threshold', DEFAULT_SLOW_COLLECTIONS_DAYS);
  // risk_threshold policy values are large amounts (e.g. 100000), not days.
  // Use the default days threshold for slow collections detection.
  const daysThreshold = threshold > 365 ? DEFAULT_SLOW_COLLECTIONS_DAYS : threshold;

  // Calculate average days-to-pay from paid invoices
  const paidInvoices = await db('invoices')
    .where({ merchant_id: merchantId, status: 'paid' })
    .whereNotNull('paid_at')
    .select('due_date', 'paid_at', 'created_at');

  if (paidInvoices.length === 0) return null;

  let totalDaysToPay = 0;
  for (const inv of paidInvoices) {
    const created = new Date(inv.created_at);
    const paid = new Date(inv.paid_at);
    const daysToPay = (paid - created) / (1000 * 60 * 60 * 24);
    totalDaysToPay += Math.max(0, daysToPay);
  }

  const avgDaysToPay = totalDaysToPay / paidInvoices.length;

  if (avgDaysToPay > daysThreshold) {
    const severity = avgDaysToPay > daysThreshold * 2 ? 'high' : 'medium';
    return createThreat({
      merchant_id: merchantId,
      threat_type: 'slow_collections',
      severity,
      description: `Average days-to-pay is ${avgDaysToPay.toFixed(1)} days (threshold: ${daysThreshold} days). Collections are slowing down across ${paidInvoices.length} paid invoices.`,
      recommended_actions: [
        'Send earlier payment reminders',
        'Offer early payment discounts',
        'Review customer payment terms',
        'Consider stricter credit policies for slow-paying customers',
      ],
    });
  }

  return null;
}

/**
 * Checks for refund spike patterns for a specific customer.
 * Generates a "customer_fraud" threat if refund requests spike abnormally.
 *
 * @param {number} customerId
 * @returns {Promise<object|null>} The threat record if generated, null otherwise
 * Requirements: 10.3
 */
export async function checkCustomerFraud(customerId) {
  // Get the customer's merchant for threshold lookup
  const customer = await db('customers').where({ id: customerId }).first();
  if (!customer) return null;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString();

  // Count recent disputes/refund requests
  const recentDisputes = await db('disputes')
    .where({ customer_id: customerId })
    .where('created_at', '>=', cutoff)
    .count('* as count')
    .first();

  const recentCount = recentDisputes?.count || 0;

  if (recentCount >= DEFAULT_FRAUD_REFUND_COUNT) {
    // Also check the total amount of refunds
    const refundAmount = await db('transactions')
      .where({ merchant_id: customer.merchant_id, type: 'outgoing', reference_type: 'dispute' })
      .where('created_at', '>=', cutoff)
      .whereIn('reference_id', function () {
        this.select('id').from('disputes').where({ customer_id: customerId });
      })
      .sum('amount as total')
      .first();

    const totalRefundAmount = refundAmount?.total || 0;
    const severity = recentCount >= DEFAULT_FRAUD_REFUND_COUNT * 2 ? 'critical'
      : recentCount >= DEFAULT_FRAUD_REFUND_COUNT + 2 ? 'high' : 'medium';

    return createThreat({
      merchant_id: customer.merchant_id,
      threat_type: 'customer_fraud',
      severity,
      description: `Customer "${customer.name}" has filed ${recentCount} dispute/refund requests in the last 30 days (threshold: ${DEFAULT_FRAUD_REFUND_COUNT}). Total refund amount: ₹${totalRefundAmount.toLocaleString('en-IN')}.`,
      recommended_actions: [
        'Review all recent disputes from this customer',
        'Verify delivery and order details for each claim',
        'Consider flagging customer for manual review',
        'Temporarily pause auto-approve refunds for this customer',
      ],
      related_customer_id: customerId,
    });
  }

  return null;
}

/**
 * Checks for unusual payment patterns across all merchants:
 * - Multiple failed payments (outgoing transactions with patterns suggesting failure)
 * - Rapid successive refunds (multiple refunds in a short window)
 *
 * @returns {Promise<Array<object>>} Array of threat records generated
 * Requirements: 10.4
 */
export async function checkPaymentAnomalies() {
  const threats = [];

  // Get all merchants
  const merchants = await db('merchants').select('id', 'name');

  for (const merchant of merchants) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString();

    // Check for rapid successive refunds in 7-day window
    const recentRefunds = await db('transactions')
      .where({ merchant_id: merchant.id, type: 'outgoing' })
      .where('created_at', '>=', cutoff)
      .orderBy('created_at', 'asc')
      .select('*');

    if (recentRefunds.length >= DEFAULT_RAPID_REFUND_COUNT) {
      const totalRefundAmount = recentRefunds.reduce((sum, tx) => sum + tx.amount, 0);
      const severity = recentRefunds.length >= DEFAULT_RAPID_REFUND_COUNT * 2 ? 'high' : 'medium';

      const threat = await createThreat({
        merchant_id: merchant.id,
        threat_type: 'rapid_refunds',
        severity,
        description: `${recentRefunds.length} refund transactions detected in the last 7 days totaling ₹${totalRefundAmount.toLocaleString('en-IN')}. This is an unusually high refund frequency.`,
        recommended_actions: [
          'Review all recent refund transactions',
          'Check for duplicate or fraudulent refund requests',
          'Verify product/service quality issues',
          'Consider temporary refund processing hold',
        ],
      });
      threats.push(threat);
    }

    // Check for multiple failed/duplicate payment patterns
    // Look for multiple outgoing transactions with the same reference_id in a short window
    const duplicateRefunds = await db('transactions')
      .where({ merchant_id: merchant.id, type: 'outgoing' })
      .where('created_at', '>=', cutoff)
      .whereNotNull('reference_id')
      .groupBy('reference_id')
      .having(db.raw('COUNT(*) > 1'))
      .select('reference_id', db.raw('COUNT(*) as count'), db.raw('SUM(amount) as total_amount'));

    for (const dup of duplicateRefunds) {
      const threat = await createThreat({
        merchant_id: merchant.id,
        threat_type: 'duplicate_payments',
        severity: 'high',
        description: `${dup.count} duplicate outgoing transactions detected for reference ID ${dup.reference_id} totaling ₹${dup.total_amount.toLocaleString('en-IN')}. Possible duplicate refund processing.`,
        recommended_actions: [
          'Verify if duplicate refunds were intentional',
          'Check Pine Labs transaction logs for confirmation',
          'Reverse duplicate transactions if confirmed',
        ],
      });
      threats.push(threat);
    }
  }

  return threats;
}

/**
 * Runs all threat detection checks across all merchants and customers.
 * This is the main entry point for periodic threat evaluation.
 *
 * @returns {Promise<Array<object>>} Array of all threat records generated
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */
export async function evaluateThreats() {
  const allThreats = [];

  // Get all merchants
  const merchants = await db('merchants').select('id');

  // Run merchant-level checks
  for (const merchant of merchants) {
    try {
      const refundThreat = await checkRefundRatio(merchant.id);
      if (refundThreat) allThreats.push(refundThreat);
    } catch (err) {
      // Log error but continue with remaining checks (per design: never suppress valid threats)
      console.error(`Threat check failed for merchant ${merchant.id} (refund ratio):`, err.message);
    }

    try {
      const slowThreat = await checkSlowCollections(merchant.id);
      if (slowThreat) allThreats.push(slowThreat);
    } catch (err) {
      console.error(`Threat check failed for merchant ${merchant.id} (slow collections):`, err.message);
    }
  }

  // Run customer-level fraud checks
  const customers = await db('customers').select('id');
  for (const customer of customers) {
    try {
      const fraudThreat = await checkCustomerFraud(customer.id);
      if (fraudThreat) allThreats.push(fraudThreat);
    } catch (err) {
      console.error(`Threat check failed for customer ${customer.id} (fraud):`, err.message);
    }
  }

  // Run anomaly detection
  try {
    const anomalyThreats = await checkPaymentAnomalies();
    allThreats.push(...anomalyThreats);
  } catch (err) {
    console.error('Threat check failed (payment anomalies):', err.message);
  }

  return allThreats;
}
