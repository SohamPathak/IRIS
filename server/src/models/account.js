/**
 * Account aggregation model — computes buyer account summaries,
 * transaction history, confidence scores, and account status.
 *
 * Requirements: 5.1–5.8
 */
import db from '../db.js';

/**
 * Compute confidence score from buyer metrics.
 * Formula from design doc:
 *  Base: 50
 *  +3 per on-time payment (cap +25)
 *  -5 per late payment (cap -30)
 *  +1 per completed transaction (cap +10)
 *  -8 per dispute (cap -20)
 *  +5 per credit line paid on time (cap +15)
 *  Clamped [0, 100]
 */
export function computeConfidenceScore({ onTimePayments = 0, latePayments = 0, transactionCount = 0, disputeCount = 0, creditLineRepayments = 0 }) {
  let score = 50;
  score += Math.min(onTimePayments * 3, 25);
  score -= Math.min(latePayments * 5, 30);
  score += Math.min(transactionCount * 1, 10);
  score -= Math.min(disputeCount * 8, 20);
  score += Math.min(creditLineRepayments * 5, 15);
  return Math.max(0, Math.min(100, score));
}

/**
 * Determine account status from overdue days and confidence score.
 */
export function computeAccountStatus(maxOverdueDays, confidenceScore) {
  if (maxOverdueDays > 30 || confidenceScore < 30) return 'at_risk';
  if (maxOverdueDays > 0 || confidenceScore <= 60) return 'need_reminders';
  return 'on_time';
}

/**
 * Determine course of action for a transaction record.
 */
export function determineCourseOfAction(pastDueDays, hasDispute) {
  if (hasDispute) return 'human_escalation';
  if (pastDueDays >= 30) return 'human_escalation';
  if (pastDueDays >= 15) return 'daily_reminder';
  if (pastDueDays >= 1) return 'weekly_reminder';
  return 'none';
}

/**
 * Get full buyer account summary.
 */
export async function getBuyerAccountSummary(buyerId) {
  const buyer = await db('customers').where({ id: buyerId }).first();
  const transactions = await db('transaction_records').where({ buyer_id: buyerId });
  const creditLines = await db('credit_lines').where({ buyer_id: buyerId });
  const disputes = await db('disputes').where({ customer_id: buyerId });

  const net_transactions = transactions.length;
  const net_payment_due = transactions
    .filter(t => t.payment_status !== 'paid')
    .reduce((sum, t) => sum + t.total_amount, 0);

  // Compute metrics for confidence score
  const now = new Date();
  const paidTxns = transactions.filter(t => t.payment_status === 'paid' && t.completed_at && t.due_date);
  const onTimePayments = paidTxns.filter(t => new Date(t.completed_at) <= new Date(t.due_date)).length;
  const latePayments = paidTxns.filter(t => new Date(t.completed_at) > new Date(t.due_date)).length;
  const creditLinePaidOnTime = creditLines.filter(c => c.status === 'paid' && c.paid_at && new Date(c.paid_at) <= new Date(c.due_date)).length;

  const confidence_score = computeConfidenceScore({
    onTimePayments,
    latePayments,
    transactionCount: transactions.length,
    disputeCount: disputes.length,
    creditLineRepayments: creditLinePaidOnTime,
  });

  // Max overdue days across active credit lines and unpaid transactions
  let maxOverdueDays = 0;
  for (const cl of creditLines.filter(c => c.status === 'active' || c.status === 'overdue')) {
    const days = Math.max(0, Math.round((now - new Date(cl.due_date)) / (1000 * 60 * 60 * 24)));
    if (days > maxOverdueDays) maxOverdueDays = days;
  }
  for (const t of transactions.filter(t => t.payment_status !== 'paid' && t.due_date)) {
    const days = Math.max(0, Math.round((now - new Date(t.due_date)) / (1000 * 60 * 60 * 24)));
    if (days > maxOverdueDays) maxOverdueDays = days;
  }

  const account_status = computeAccountStatus(maxOverdueDays, confidence_score);

  return { buyer_id: buyerId, name: buyer?.name || null, net_transactions, net_payment_due, account_status, confidence_score };
}

/**
 * Get buyer transaction history with derived columns.
 */
export async function getBuyerTransactionHistory(buyerId) {
  const transactions = await db('transaction_records')
    .where({ buyer_id: buyerId })
    .join('commodities', 'transaction_records.commodity_id', 'commodities.id')
    .select(
      'transaction_records.*',
      'commodities.name as commodity_name',
      'commodities.unit as commodity_unit',
    )
    .orderBy('transaction_records.created_at', 'desc');

  const disputes = await db('disputes').where({ customer_id: buyerId });
  const disputeInvoiceIds = new Set(disputes.map(d => d.invoice_id));

  const now = new Date();

  return transactions.map(t => {
    const hasDispute = disputes.some(d => d.customer_id === buyerId && d.status !== 'resolved');
    const pastDueDays = t.due_date ? Math.max(0, Math.round((now - new Date(t.due_date)) / (1000 * 60 * 60 * 24))) : 0;

    let status;
    if (t.payment_status === 'paid') status = 'fulfilled';
    else if (hasDispute) status = 'dispute_raised';
    else if (t.payment_status === 'partial') status = 'pending_partial_payment';
    else status = 'pending_full_payment';

    const amountRecovered = t.payment_status === 'paid' ? t.total_amount : (t.payment_status === 'partial' ? t.total_amount * 0.5 : 0);

    return {
      id: t.id,
      description: `${t.commodity_name} — ${t.quantity} ${t.commodity_unit} @ ₹${t.agreed_price_per_unit}/${t.commodity_unit}`,
      status,
      course_of_action: determineCourseOfAction(pastDueDays, hasDispute),
      amount_recovered: amountRecovered,
      shipping_date: t.shipping_date,
      past_due_days: pastDueDays,
      total_amount: t.total_amount,
      payment_method: t.payment_method,
      created_at: t.created_at,
    };
  });
}

/**
 * List all buyer accounts with summary metrics.
 */
export async function listBuyerAccounts(merchantId) {
  const buyers = await db('customers').where({ merchant_id: merchantId || 1 });
  const results = [];
  for (const buyer of buyers) {
    const summary = await getBuyerAccountSummary(buyer.id);
    results.push({ ...buyer, ...summary });
  }
  return results;
}
