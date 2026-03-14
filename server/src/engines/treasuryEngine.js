import db from '../db.js';

/**
 * Treasury Engine — Tracks money movement, predicts cash flow, and generates financial alerts.
 *
 * Responsibilities:
 * - Record incoming/outgoing transactions with Pine Labs references (Req 8.1, 8.2)
 * - Maintain running net cash flow balance (Req 8.3)
 * - Display money movement timeline with running balance (Req 8.4)
 * - Generate 90-day cash flow predictions (Req 9.1)
 * - Alert on predicted negative balance within 30 days (Req 9.2)
 * - Cash flow summary for time period (Req 11.1)
 */

/**
 * Records a transaction (incoming or outgoing) in the database.
 *
 * @param {object} txData
 * @param {number} txData.merchant_id
 * @param {'incoming'|'outgoing'} txData.type
 * @param {number} txData.amount - Positive amount in INR
 * @param {string} [txData.reference_type] - 'invoice', 'dispute', 'installment'
 * @param {number} [txData.reference_id]
 * @param {string} [txData.pine_labs_ref]
 * @param {string} [txData.created_at] - ISO date string; defaults to now
 * @returns {Promise<object>} The inserted transaction record
 * Requirements: 8.1, 8.2
 */
export async function recordTransaction(txData) {
  if (!txData.merchant_id || !txData.type || txData.amount == null) {
    throw new Error('merchant_id, type, and amount are required');
  }
  if (!['incoming', 'outgoing'].includes(txData.type)) {
    throw new Error('type must be "incoming" or "outgoing"');
  }
  if (typeof txData.amount !== 'number' || txData.amount <= 0) {
    throw new Error('amount must be a positive number');
  }

  const record = {
    merchant_id: txData.merchant_id,
    type: txData.type,
    amount: txData.amount,
    reference_type: txData.reference_type || null,
    reference_id: txData.reference_id || null,
    pine_labs_ref: txData.pine_labs_ref || null,
    created_at: txData.created_at || new Date().toISOString(),
  };

  const [id] = await db('transactions').insert(record);
  return { id, ...record };
}

/**
 * Computes the running net cash flow balance for a merchant.
 * Net balance = sum(incoming) - sum(outgoing)
 *
 * @param {number} merchantId
 * @returns {Promise<{ total_incoming: number, total_outgoing: number, net_balance: number }>}
 * Requirements: 8.3
 */
export async function getNetBalance(merchantId) {
  const incoming = await db('transactions')
    .where({ merchant_id: merchantId, type: 'incoming' })
    .sum('amount as total')
    .first();

  const outgoing = await db('transactions')
    .where({ merchant_id: merchantId, type: 'outgoing' })
    .sum('amount as total')
    .first();

  const totalIncoming = incoming?.total || 0;
  const totalOutgoing = outgoing?.total || 0;

  return {
    total_incoming: totalIncoming,
    total_outgoing: totalOutgoing,
    net_balance: totalIncoming - totalOutgoing,
  };
}

/**
 * Returns a timeline of transactions with a running balance for the given period.
 *
 * @param {number} merchantId
 * @param {object} [period]
 * @param {string} [period.startDate] - ISO date string
 * @param {string} [period.endDate] - ISO date string
 * @returns {Promise<Array<{ id: number, type: string, amount: number, reference_type: string, reference_id: number, pine_labs_ref: string, created_at: string, running_balance: number }>>}
 * Requirements: 8.4
 */
export async function getCashFlowTimeline(merchantId, period = {}) {
  let query = db('transactions')
    .where({ merchant_id: merchantId })
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc');

  if (period.startDate) {
    query = query.where('created_at', '>=', period.startDate);
  }
  if (period.endDate) {
    query = query.where('created_at', '<=', period.endDate);
  }

  const transactions = await query.select('*');

  // Compute running balance across the timeline
  let runningBalance = 0;

  // If there's a startDate filter, we need the balance before that date
  if (period.startDate) {
    const prior = await db('transactions')
      .where({ merchant_id: merchantId })
      .where('created_at', '<', period.startDate)
      .select(
        db.raw("SUM(CASE WHEN type = 'incoming' THEN amount ELSE 0 END) as total_in"),
        db.raw("SUM(CASE WHEN type = 'outgoing' THEN amount ELSE 0 END) as total_out"),
      )
      .first();
    runningBalance = (prior?.total_in || 0) - (prior?.total_out || 0);
  }

  return transactions.map((tx) => {
    if (tx.type === 'incoming') {
      runningBalance += tx.amount;
    } else {
      runningBalance -= tx.amount;
    }
    return { ...tx, running_balance: runningBalance };
  });
}

/**
 * Generates 90-day cash flow predictions for a merchant based on:
 * - Pending/overdue invoices (expected incoming)
 * - Historical refund trends (expected outgoing)
 *
 * Stores predictions in cash_flow_predictions table.
 *
 * @param {number} merchantId
 * @returns {Promise<Array<object>>} Array of daily prediction records
 * Requirements: 9.1
 */
export async function generatePredictions(merchantId) {
  const now = new Date();
  const generatedAt = now.toISOString();

  // 1. Get pending/overdue invoices for expected incoming
  const pendingInvoices = await db('invoices')
    .where({ merchant_id: merchantId })
    .whereIn('status', ['pending', 'overdue', 'partial'])
    .select('balance_due', 'due_date', 'status');

  // 2. Compute average daily refund from last 90 days for outgoing trend
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const refundData = await db('transactions')
    .where({ merchant_id: merchantId, type: 'outgoing' })
    .where('created_at', '>=', ninetyDaysAgo.toISOString())
    .sum('amount as total_refunds')
    .count('* as refund_count')
    .first();

  const totalRefunds = refundData?.total_refunds || 0;
  const avgDailyRefund = totalRefunds / 90;

  // 3. Build a map of expected incoming by date from pending invoices
  const incomingByDate = {};
  for (const inv of pendingInvoices) {
    // For overdue invoices, spread expected payment over next 30 days
    // For pending invoices, expect payment around due date
    let expectedDate;
    const dueDate = new Date(inv.due_date);

    if (inv.status === 'overdue' || dueDate < now) {
      // Spread overdue amounts over next 30 days
      for (let d = 1; d <= 30; d++) {
        const spreadDate = new Date(now);
        spreadDate.setDate(spreadDate.getDate() + d);
        const key = spreadDate.toISOString().split('T')[0];
        incomingByDate[key] = (incomingByDate[key] || 0) + inv.balance_due / 30;
      }
      continue;
    }

    expectedDate = inv.due_date.split('T')[0];
    incomingByDate[expectedDate] = (incomingByDate[expectedDate] || 0) + inv.balance_due;
  }

  // 4. Generate daily predictions for 90 days
  // Clear old predictions for this merchant
  await db('cash_flow_predictions').where({ merchant_id: merchantId }).del();

  const predictions = [];
  for (let d = 1; d <= 90; d++) {
    const predDate = new Date(now);
    predDate.setDate(predDate.getDate() + d);
    const dateKey = predDate.toISOString().split('T')[0];

    const predictedIncoming = incomingByDate[dateKey] || 0;
    const predictedOutgoing = avgDailyRefund;
    const predictedNet = predictedIncoming - predictedOutgoing;

    predictions.push({
      merchant_id: merchantId,
      prediction_date: dateKey,
      predicted_incoming: Math.round(predictedIncoming * 100) / 100,
      predicted_outgoing: Math.round(predictedOutgoing * 100) / 100,
      predicted_net: Math.round(predictedNet * 100) / 100,
      generated_at: generatedAt,
    });
  }

  if (predictions.length > 0) {
    await db('cash_flow_predictions').insert(predictions);
  }

  return predictions;
}

/**
 * Checks if predicted cash flow goes negative within 30 days.
 * If so, creates a threat alert.
 *
 * @param {number} merchantId
 * @returns {Promise<{ atRisk: boolean, riskDate: string|null, predictedBalance: number|null, threat: object|null }>}
 * Requirements: 9.2
 */
export async function checkCashFlowRisk(merchantId) {
  // Get current net balance
  const { net_balance: currentBalance } = await getNetBalance(merchantId);

  // Get predictions for next 30 days
  const now = new Date();
  const thirtyDaysOut = new Date(now);
  thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);

  const predictions = await db('cash_flow_predictions')
    .where({ merchant_id: merchantId })
    .where('prediction_date', '>=', now.toISOString().split('T')[0])
    .where('prediction_date', '<=', thirtyDaysOut.toISOString().split('T')[0])
    .orderBy('prediction_date', 'asc')
    .select('*');

  // Walk through predictions accumulating net changes
  let projectedBalance = currentBalance;
  for (const pred of predictions) {
    projectedBalance += pred.predicted_net;

    if (projectedBalance < 0) {
      // Create a threat alert
      const threat = {
        merchant_id: merchantId,
        threat_type: 'negative_cash_flow',
        severity: projectedBalance < -50000 ? 'critical' : projectedBalance < -10000 ? 'high' : 'medium',
        description: `Predicted negative cash flow balance of ₹${Math.round(projectedBalance).toLocaleString('en-IN')} by ${pred.prediction_date}`,
        recommended_actions: JSON.stringify([
          'Follow up on overdue invoices immediately',
          'Consider pausing non-essential refunds',
          'Review upcoming payment obligations',
        ]),
        status: 'active',
        created_at: new Date().toISOString(),
      };

      await db('threats').insert(threat);

      return {
        atRisk: true,
        riskDate: pred.prediction_date,
        predictedBalance: Math.round(projectedBalance * 100) / 100,
        threat,
      };
    }
  }

  return { atRisk: false, riskDate: null, predictedBalance: null, threat: null };
}

/**
 * Returns a cash flow summary for the given time period.
 *
 * @param {number} merchantId
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @returns {Promise<{ total_incoming: number, total_outgoing: number, net_balance: number, transaction_count: number, period: { start: string, end: string } }>}
 * Requirements: 11.1
 */
export async function getCashFlowSummary(merchantId, startDate, endDate) {
  if (!merchantId || !startDate || !endDate) {
    throw new Error('merchantId, startDate, and endDate are required');
  }

  const result = await db('transactions')
    .where({ merchant_id: merchantId })
    .where('created_at', '>=', startDate)
    .where('created_at', '<=', endDate)
    .select(
      db.raw("SUM(CASE WHEN type = 'incoming' THEN amount ELSE 0 END) as total_incoming"),
      db.raw("SUM(CASE WHEN type = 'outgoing' THEN amount ELSE 0 END) as total_outgoing"),
      db.raw('COUNT(*) as transaction_count'),
    )
    .first();

  const totalIncoming = result?.total_incoming || 0;
  const totalOutgoing = result?.total_outgoing || 0;

  return {
    total_incoming: totalIncoming,
    total_outgoing: totalOutgoing,
    net_balance: totalIncoming - totalOutgoing,
    transaction_count: result?.transaction_count || 0,
    period: { start: startDate, end: endDate },
  };
}
