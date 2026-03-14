import db from '../db.js';
import pinelabsService from '../services/pinelabsService.js';
import { getBestProfile, upsertProfile } from '../models/customerResponseProfile.js';
import riskScoringService from '../services/riskScoringService.js';

/**
 * Collection Agent — Autonomous agent for managing accounts receivable.
 *
 * Responsibilities:
 * - Mark overdue invoices and trigger friendly reminders (Req 1.3, 2.1)
 * - Escalate reminders: friendly → firm → final after 7-day intervals (Req 2.2, 2.3)
 * - Include Pine Labs payment links in every reminder (Req 2.4)
 * - Log all actions in action_logs (Req 2.5)
 */

const ESCALATION_ORDER = ['friendly', 'firm', 'final'];
const ESCALATION_WAIT_DAYS = 7;
const DEFAULT_CHANNEL = 'email';

/**
 * Evaluate all pending invoices and mark those past due_date as overdue.
 * For each newly overdue invoice, sends a friendly reminder.
 *
 * @returns {{ markedOverdue: number, remindersSent: number }}
 * Requirements: 1.3, 2.1
 */
export async function evaluateOverdueInvoices() {
  const now = new Date().toISOString();

  // Find all pending invoices past their due date
  const overdueInvoices = await db('invoices')
    .where('status', 'pending')
    .where('due_date', '<', now)
    .select('*');

  let markedOverdue = 0;
  let remindersSent = 0;

  for (const invoice of overdueInvoices) {
    await db.transaction(async (trx) => {
      // Mark as overdue
      await trx('invoices')
        .where({ id: invoice.id })
        .update({ status: 'overdue' });

      // Record status transition
      await trx('invoice_status_history').insert({
        invoice_id: invoice.id,
        old_status: 'pending',
        new_status: 'overdue',
        reason: 'Invoice past due date — marked overdue by Collection Agent',
      });
    });

    markedOverdue++;

    // Send friendly reminder
    await sendReminder(invoice.id, 'friendly');
    remindersSent++;
  }

  return { markedOverdue, remindersSent };
}


/**
 * Escalate reminders that have gone unanswered for 7+ days.
 * friendly → firm after 7 days, firm → final after 7 days.
 * Final reminders are not escalated further.
 *
 * @returns {{ escalated: number }}
 * Requirements: 2.2, 2.3
 */
export async function escalateReminders() {
  const cutoff = new Date(Date.now() - ESCALATION_WAIT_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Find reminders that are sent, have no response, and were sent more than 7 days ago
  const pendingReminders = await db('reminders')
    .where('status', 'sent')
    .whereNull('responded_at')
    .where('sent_at', '<', cutoff)
    .whereIn('escalation_level', ['friendly', 'firm'])
    .select('*');

  let escalated = 0;

  for (const reminder of pendingReminders) {
    const currentIdx = ESCALATION_ORDER.indexOf(reminder.escalation_level);
    if (currentIdx < 0 || currentIdx >= ESCALATION_ORDER.length - 1) {
      continue; // Already at final or unknown level
    }

    const nextLevel = ESCALATION_ORDER[currentIdx + 1];

    // Check if a reminder at the next level already exists for this invoice
    const existing = await db('reminders')
      .where({ invoice_id: reminder.invoice_id, escalation_level: nextLevel })
      .first();

    if (existing) continue; // Already escalated

    await sendReminder(reminder.invoice_id, nextLevel);
    escalated++;
  }

  return { escalated };
}

/**
 * Send a reminder at the given escalation level for an invoice.
 * Creates a Pine Labs payment link and records the reminder + action log.
 *
 * @param {number} invoiceId
 * @param {string} level - 'friendly' | 'firm' | 'final'
 * @returns {object} The created reminder record
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */
export async function sendReminder(invoiceId, level) {
  if (!ESCALATION_ORDER.includes(level)) {
    throw new Error(`Invalid escalation level: ${level}. Must be one of: ${ESCALATION_ORDER.join(', ')}`);
  }

  const invoice = await db('invoices').where({ id: invoiceId }).first();
  if (!invoice) {
    throw new Error(`Invoice with ID ${invoiceId} not found`);
  }

  // Create Pine Labs payment link
  const { paymentLink } = await pinelabsService.createPaymentLink(
    invoiceId,
    invoice.balance_due,
  );

  // Insert reminder record
  const [reminder] = await db('reminders')
    .insert({
      invoice_id: invoiceId,
      customer_id: invoice.customer_id,
      escalation_level: level,
      channel: DEFAULT_CHANNEL,
      payment_link: paymentLink,
      status: 'sent',
    })
    .returning('*');

  // Log the action
  await db('action_logs').insert({
    merchant_id: invoice.merchant_id,
    agent_type: 'collection',
    decision_type: 'send_reminder',
    inputs: JSON.stringify({ invoice_id: invoiceId, escalation_level: level, balance_due: invoice.balance_due }),
    policy_rules_applied: JSON.stringify([]),
    outcome: `Sent ${level} reminder for invoice #${invoiceId}`,
    reasoning: `Invoice #${invoiceId} is overdue with balance ₹${invoice.balance_due}. Sent ${level} reminder with Pine Labs payment link.`,
  });

  return reminder;
}


/**
 * Record that a customer paid after receiving a reminder at a given
 * escalation level and channel. Updates the customer_response_profiles table.
 *
 * @param {number} customerId
 * @param {string} escalationLevel - 'friendly' | 'firm' | 'final'
 * @param {string} channel - 'email' | 'sms' | 'whatsapp'
 * @returns {Promise<object>} The updated profile row
 * Requirements: 3.1, 3.3
 */
export async function recordReminderSuccess(customerId, escalationLevel, channel) {
  return upsertProfile(customerId, escalationLevel, channel, true);
}

/**
 * Select the best reminder strategy (escalation level + channel) for a customer
 * based on their historical response profile. Returns the combination with the
 * highest success rate. Falls back to defaults if no history exists.
 *
 * @param {number} customerId
 * @returns {Promise<{ escalationLevel: string, channel: string }>}
 * Requirements: 3.2
 */
export async function selectReminderStrategy(customerId) {
  const best = await getBestProfile(customerId);

  if (best) {
    return {
      escalationLevel: best.escalation_level,
      channel: best.channel,
    };
  }

  // No historical data — fall back to defaults
  return {
    escalationLevel: ESCALATION_ORDER[0],
    channel: DEFAULT_CHANNEL,
  };
}


/**
 * Offer a payment plan (EMI) for an overdue invoice, if a matching policy rule exists.
 *
 * Checks active policy_rules with condition_type='emi_eligibility' for the invoice's merchant.
 * If the invoice has been overdue for more than the configured number of days, creates a
 * payment_plan with installments and generates Pine Labs payment links for each.
 *
 * @param {number} invoiceId
 * @returns {Promise<{ offered: boolean, plan?: object, installments?: object[], reason: string }>}
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
export async function offerPaymentPlan(invoiceId) {
  const invoice = await db('invoices').where({ id: invoiceId }).first();
  if (!invoice) {
    throw new Error(`Invoice with ID ${invoiceId} not found`);
  }

  if (invoice.status !== 'overdue') {
    return { offered: false, reason: `Invoice is not overdue (status: ${invoice.status})` };
  }

  // Check if a payment plan already exists for this invoice
  const existingPlan = await db('payment_plans').where({ invoice_id: invoiceId }).first();
  if (existingPlan) {
    return { offered: false, reason: 'Payment plan already exists for this invoice' };
  }

  // Find active EMI eligibility policy rules for this merchant
  const emiRules = await db('policy_rules')
    .where({ merchant_id: invoice.merchant_id, condition_type: 'emi_eligibility', is_active: 1 })
    .select('*');

  if (emiRules.length === 0) {
    return { offered: false, reason: 'No active EMI eligibility policy rules found' };
  }

  // Check if the invoice has been overdue long enough
  const dueDate = new Date(invoice.due_date);
  const now = new Date();
  const overdueDays = Math.floor((now - dueDate) / (24 * 60 * 60 * 1000));

  let matchedRule = null;
  for (const rule of emiRules) {
    let conditionValue;
    try {
      conditionValue = JSON.parse(rule.condition_value);
    } catch {
      conditionValue = { overdue_days: Number(rule.condition_value) };
    }
    const requiredDays = conditionValue.overdue_days || 0;
    if (overdueDays > requiredDays) {
      matchedRule = rule;
      break;
    }
  }

  if (!matchedRule) {
    return { offered: false, reason: `Invoice overdue for ${overdueDays} days, does not meet EMI threshold` };
  }

  // Determine number of installments from the action_value
  let actionValue;
  try {
    actionValue = JSON.parse(matchedRule.action_value);
  } catch {
    actionValue = { num_installments: 3 };
  }
  const numInstallments = actionValue.num_installments || 3;

  // Calculate installment amounts (Req 4.4)
  const balance = invoice.balance_due;
  const baseAmount = Math.floor((balance / numInstallments) * 100) / 100;
  const remainder = Math.round((balance - baseAmount * numInstallments) * 100) / 100;

  // Create payment plan and installments in a transaction
  const result = await db.transaction(async (trx) => {
    const [plan] = await trx('payment_plans')
      .insert({
        invoice_id: invoiceId,
        customer_id: invoice.customer_id,
        num_installments: numInstallments,
        installment_amount: baseAmount,
        status: 'active',
      })
      .returning('*');

    const installments = [];
    for (let i = 1; i <= numInstallments; i++) {
      // Last installment absorbs rounding remainder
      const amount = i === numInstallments ? baseAmount + remainder : baseAmount;
      const dueDate = new Date(now.getTime() + i * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Generate Pine Labs payment link for each installment (Req 4.2)
      const { paymentLink } = await pinelabsService.createPaymentLink(invoiceId, amount);

      const [installment] = await trx('installments')
        .insert({
          payment_plan_id: plan.id,
          installment_number: i,
          amount,
          due_date: dueDate,
          status: 'pending',
          payment_link: paymentLink,
        })
        .returning('*');

      installments.push(installment);
    }

    // Log the action
    await trx('action_logs').insert({
      merchant_id: invoice.merchant_id,
      agent_type: 'collection',
      decision_type: 'offer_payment_plan',
      inputs: JSON.stringify({ invoice_id: invoiceId, balance_due: balance, overdue_days: overdueDays }),
      policy_rules_applied: JSON.stringify([{ id: matchedRule.id, name: matchedRule.name }]),
      outcome: `Offered ${numInstallments}-installment payment plan for invoice #${invoiceId}`,
      reasoning: `Invoice #${invoiceId} overdue for ${overdueDays} days (threshold: ${JSON.parse(matchedRule.condition_value).overdue_days} days). Created ${numInstallments} installments of ~₹${baseAmount} each from balance ₹${balance}.`,
    });

    return { plan, installments };
  });

  return { offered: true, plan: result.plan, installments: result.installments, reason: 'Payment plan created' };
}


/**
 * Check for missed installments and send reminders. Flags the payment plan as defaulted
 * if any installment is missed.
 *
 * A missed installment is one whose due_date is in the past and status is still 'pending'.
 *
 * @returns {Promise<{ missed: number, reminders: number }>}
 * Requirements: 4.3
 */
export async function handleMissedInstallments() {
  const now = new Date().toISOString();

  // Find pending installments past their due date
  const overdueInstallments = await db('installments')
    .where('installments.status', 'pending')
    .where('installments.due_date', '<', now)
    .join('payment_plans', 'installments.payment_plan_id', 'payment_plans.id')
    .where('payment_plans.status', 'active')
    .select(
      'installments.*',
      'payment_plans.invoice_id',
      'payment_plans.customer_id',
    );

  let missed = 0;
  let reminders = 0;

  for (const inst of overdueInstallments) {
    // Mark installment as missed
    await db('installments')
      .where({ id: inst.id })
      .update({ status: 'missed' });

    missed++;

    // Get the invoice for merchant_id
    const invoice = await db('invoices').where({ id: inst.invoice_id }).first();
    if (!invoice) continue;

    // Send a reminder for the missed installment
    const { paymentLink } = await pinelabsService.createPaymentLink(
      inst.invoice_id,
      inst.amount,
    );

    await db('reminders').insert({
      invoice_id: inst.invoice_id,
      customer_id: inst.customer_id,
      escalation_level: 'firm',
      channel: DEFAULT_CHANNEL,
      payment_link: paymentLink,
      status: 'sent',
    });

    reminders++;

    // Flag the payment plan as defaulted
    await db('payment_plans')
      .where({ id: inst.payment_plan_id })
      .update({ status: 'defaulted' });

    // Log the action
    await db('action_logs').insert({
      merchant_id: invoice.merchant_id,
      agent_type: 'collection',
      decision_type: 'missed_installment',
      inputs: JSON.stringify({
        installment_id: inst.id,
        installment_number: inst.installment_number,
        invoice_id: inst.invoice_id,
        amount: inst.amount,
      }),
      policy_rules_applied: JSON.stringify([]),
      outcome: `Missed installment #${inst.installment_number} for invoice #${inst.invoice_id} — sent reminder and flagged plan`,
      reasoning: `Installment #${inst.installment_number} (₹${inst.amount}) was due on ${inst.due_date} but not paid. Sent firm reminder with payment link and flagged payment plan as defaulted.`,
    });
  }

  return { missed, reminders };
}


/**
 * Compute and update the risk score for a single customer.
 *
 * Gathers payment history data from the database:
 * - latePaymentCount: invoices that were paid after due_date
 * - onTimePaymentCount: invoices paid on or before due_date
 * - overdueInvoiceCount: currently active overdue invoices
 * - avgDaysToPay: average days between invoice creation and payment
 *
 * Calls riskScoringService.computeRiskScore() and categorizeRisk(),
 * then updates the customer record with the new score and category.
 *
 * @param {number} customerId
 * @returns {Promise<{ customerId: number, riskScore: number, riskCategory: string }>}
 * Requirements: 5.2, 5.4
 */
export async function computeCustomerRiskScore(customerId) {
  const customer = await db('customers').where({ id: customerId }).first();
  if (!customer) {
    throw new Error(`Customer with ID ${customerId} not found`);
  }

  // Count late payments: paid invoices where paid_at > due_date
  const latePayments = await db('invoices')
    .where({ customer_id: customerId, status: 'paid' })
    .whereRaw('paid_at > due_date')
    .count('* as count')
    .first();
  const latePaymentCount = latePayments?.count || 0;

  // Count on-time payments: paid invoices where paid_at <= due_date
  const onTimePayments = await db('invoices')
    .where({ customer_id: customerId, status: 'paid' })
    .whereRaw('paid_at <= due_date')
    .count('* as count')
    .first();
  const onTimePaymentCount = onTimePayments?.count || 0;

  // Count currently overdue invoices
  const overdueInvoices = await db('invoices')
    .where({ customer_id: customerId, status: 'overdue' })
    .count('* as count')
    .first();
  const overdueInvoiceCount = overdueInvoices?.count || 0;

  // Compute average days to pay (for paid invoices)
  const paidInvoices = await db('invoices')
    .where({ customer_id: customerId, status: 'paid' })
    .whereNotNull('paid_at')
    .select('created_at', 'paid_at');

  let avgDaysToPay = 0;
  if (paidInvoices.length > 0) {
    const totalDays = paidInvoices.reduce((sum, inv) => {
      const created = new Date(inv.created_at);
      const paid = new Date(inv.paid_at);
      return sum + (paid - created) / (24 * 60 * 60 * 1000);
    }, 0);
    avgDaysToPay = totalDays / paidInvoices.length;
  }

  const paymentHistory = {
    latePaymentCount: Number(latePaymentCount),
    onTimePaymentCount: Number(onTimePaymentCount),
    overdueInvoiceCount: Number(overdueInvoiceCount),
  };

  const riskScore = riskScoringService.computeRiskScore(paymentHistory, 0, avgDaysToPay);
  const riskCategory = riskScoringService.categorizeRisk(riskScore);

  // Update customer record
  await db('customers')
    .where({ id: customerId })
    .update({ risk_score: riskScore, risk_category: riskCategory });

  return { customerId, riskScore, riskCategory };
}


/**
 * Flag high-risk accounts by computing risk scores for all customers
 * and flagging those whose total overdue invoice amount exceeds the
 * merchant-configured threshold (policy_rules with condition_type='risk_threshold').
 *
 * For each customer:
 * 1. Recompute risk score via computeCustomerRiskScore()
 * 2. Check if total overdue amount exceeds merchant threshold
 * 3. If so, flag as high-risk and log the action
 *
 * @returns {Promise<{ evaluated: number, flagged: number }>}
 * Requirements: 5.1, 5.2, 5.3
 */
export async function flagHighRiskAccounts() {
  const customers = await db('customers').select('*');

  let evaluated = 0;
  let flagged = 0;

  for (const customer of customers) {
    evaluated++;

    // Recompute risk score
    const { riskScore, riskCategory } = await computeCustomerRiskScore(customer.id);

    // Get merchant's risk threshold policy
    const thresholdRule = await db('policy_rules')
      .where({
        merchant_id: customer.merchant_id,
        condition_type: 'risk_threshold',
        is_active: 1,
      })
      .first();

    let overdueThreshold = 0;
    if (thresholdRule) {
      try {
        const conditionValue = JSON.parse(thresholdRule.condition_value);
        overdueThreshold = conditionValue.overdue_amount || 0;
      } catch {
        overdueThreshold = Number(thresholdRule.condition_value) || 0;
      }
    }

    // Sum total overdue invoice amounts for this customer
    const overdueTotal = await db('invoices')
      .where({ customer_id: customer.id, status: 'overdue' })
      .sum('balance_due as total')
      .first();
    const totalOverdue = overdueTotal?.total || 0;

    // Flag as high-risk if overdue amount exceeds threshold
    if (thresholdRule && totalOverdue > overdueThreshold) {
      // Only flag if not already high-risk
      if (riskCategory !== 'high') {
        await db('customers')
          .where({ id: customer.id })
          .update({ risk_category: 'high' });
      }

      flagged++;

      // Log the flagging action
      await db('action_logs').insert({
        merchant_id: customer.merchant_id,
        agent_type: 'collection',
        decision_type: 'flag_high_risk',
        inputs: JSON.stringify({
          customer_id: customer.id,
          risk_score: riskScore,
          total_overdue: totalOverdue,
          threshold: overdueThreshold,
        }),
        policy_rules_applied: JSON.stringify([{ id: thresholdRule.id, name: thresholdRule.name }]),
        outcome: `Flagged customer #${customer.id} as high-risk`,
        reasoning: `Customer #${customer.id} has ₹${totalOverdue} in overdue invoices, exceeding threshold of ₹${overdueThreshold}. Risk score: ${riskScore} (${riskCategory}).`,
      });
    }
  }

  return { evaluated, flagged };
}


/**
 * Get a prioritized collection list for a merchant, sorted by risk score
 * in descending order (highest risk first).
 *
 * Returns customers with overdue invoices, ordered by risk_score DESC.
 *
 * @param {number} merchantId
 * @returns {Promise<Array<{ id: number, name: string, email: string, risk_score: number, risk_category: string, total_overdue: number }>>}
 * Requirements: 12.3
 */
export async function getPrioritizedCollectionList(merchantId) {
  const customers = await db('customers')
    .where({ 'customers.merchant_id': merchantId })
    .whereExists(function () {
      this.select(db.raw(1))
        .from('invoices')
        .whereRaw('invoices.customer_id = customers.id')
        .where('invoices.status', 'overdue');
    })
    .select(
      'customers.id',
      'customers.name',
      'customers.email',
      'customers.phone',
      'customers.risk_score',
      'customers.risk_category',
    )
    .orderBy('customers.risk_score', 'desc');

  // Attach total overdue amount for each customer
  const result = [];
  for (const customer of customers) {
    const overdueTotal = await db('invoices')
      .where({ customer_id: customer.id, status: 'overdue' })
      .sum('balance_due as total')
      .first();

    result.push({
      ...customer,
      total_overdue: overdueTotal?.total || 0,
    });
  }

  return result;
}

// --- Credit Line Tracking (Bidding Agent integration) ---
// Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 5.8

import * as CreditLineModel from '../models/creditLine.js';
import { computeConfidenceScore, computeAccountStatus, getBuyerAccountSummary } from '../models/account.js';

/**
 * Track a credit line — creates collection tracking and schedules reminders.
 * Requirements: 6.1, 6.2
 */
export async function trackCreditLine(creditLineId) {
  const cl = await CreditLineModel.getById(creditLineId);
  if (!cl) throw new Error('Credit line not found');

  const txRecord = await db('transaction_records').where({ id: cl.transaction_record_id }).first();

  await db('action_logs').insert({
    merchant_id: cl.merchant_id,
    agent_type: 'collection_agent',
    decision_type: 'credit_line_tracking_started',
    inputs: JSON.stringify({ credit_line_id: cl.id, buyer_id: cl.buyer_id, amount: cl.amount, due_date: cl.due_date }),
    policy_rules_applied: null,
    outcome: 'tracking_started',
    reasoning: `Credit line ₹${cl.amount} for buyer ${cl.buyer_id} tracked. Due: ${cl.due_date}.`,
    created_at: new Date().toISOString(),
  });

  return cl;
}

/**
 * Handle a credit line payment event.
 * Requirements: 6.5
 */
export async function handleCreditLinePayment(creditLineId, paymentData) {
  const cl = await CreditLineModel.getById(creditLineId);
  if (!cl) throw new Error('Credit line not found');

  const { status: paymentStatus } = paymentData;
  let newStatus;
  if (paymentStatus === 'paid') {
    newStatus = 'paid';
  } else if (paymentStatus === 'partial') {
    newStatus = 'active'; // still active
  } else {
    newStatus = 'defaulted';
  }

  await CreditLineModel.updateStatus(creditLineId, newStatus);

  // Update buyer confidence score by logging the event
  const prevSummary = await getBuyerAccountSummary(cl.buyer_id);
  const isOnTime = paymentStatus === 'paid' && new Date() <= new Date(cl.due_date);

  await db('action_logs').insert({
    merchant_id: cl.merchant_id,
    agent_type: 'collection_agent',
    decision_type: 'credit_line_payment',
    inputs: JSON.stringify({ credit_line_id: cl.id, payment_status: paymentStatus, on_time: isOnTime }),
    policy_rules_applied: null,
    outcome: newStatus,
    reasoning: `Credit line payment: ${paymentStatus}. ${isOnTime ? 'On time.' : 'Late or missed.'}`,
    created_at: new Date().toISOString(),
  });

  // Check if account status changed
  const newSummary = await getBuyerAccountSummary(cl.buyer_id);
  if (prevSummary.account_status !== newSummary.account_status) {
    await db('action_logs').insert({
      merchant_id: cl.merchant_id,
      agent_type: 'collection_agent',
      decision_type: 'account_status_change',
      inputs: JSON.stringify({
        buyer_id: cl.buyer_id,
        previous_status: prevSummary.account_status,
        new_status: newSummary.account_status,
        confidence_score: newSummary.confidence_score,
      }),
      policy_rules_applied: null,
      outcome: newSummary.account_status,
      reasoning: `Account status changed from ${prevSummary.account_status} to ${newSummary.account_status}.`,
      created_at: new Date().toISOString(),
    });
  }

  return newSummary;
}

/**
 * Escalate credit line reminders following friendly → firm → final pattern.
 * Requirements: 6.3, 6.4
 */
export async function escalateCreditLineReminders() {
  const now = new Date();
  const activeCreditLines = await db('credit_lines').where('status', 'active');
  const results = [];

  for (const cl of activeCreditLines) {
    const dueDate = new Date(cl.due_date);
    const daysUntilDue = Math.round((dueDate - now) / (1000 * 60 * 60 * 24));
    const daysOverdue = Math.max(0, -daysUntilDue);

    // Send reminder 7 days before due date
    if (daysUntilDue <= 7 && daysUntilDue > 0) {
      // Friendly pre-due reminder
      const txRecord = await db('transaction_records').where({ id: cl.transaction_record_id }).first();
      let paymentLink = cl.payment_link;
      if (!paymentLink) {
        const plResult = await pinelabsService.createPaymentLink(`CL-${cl.id}`, cl.amount);
        paymentLink = plResult.paymentLink;
      }

      await db('reminders').insert({
        invoice_id: txRecord?.bid_id || 0,
        customer_id: cl.buyer_id,
        escalation_level: 'friendly',
        channel: 'email',
        payment_link: paymentLink,
        status: 'sent',
        sent_at: now.toISOString(),
      });

      await db('action_logs').insert({
        merchant_id: cl.merchant_id,
        agent_type: 'collection_agent',
        decision_type: 'credit_line_reminder',
        inputs: JSON.stringify({ credit_line_id: cl.id, level: 'friendly', payment_link: paymentLink, transaction_id: cl.transaction_record_id }),
        policy_rules_applied: null,
        outcome: 'reminder_sent',
        reasoning: `Friendly reminder sent for credit line ₹${cl.amount}. Due in ${daysUntilDue} days.`,
        created_at: now.toISOString(),
      });

      results.push({ credit_line_id: cl.id, level: 'friendly' });
    }

    // Overdue escalation
    if (daysOverdue > 0) {
      await CreditLineModel.updateStatus(cl.id, 'overdue');

      let level = 'friendly';
      if (daysOverdue > 14) level = 'final';
      else if (daysOverdue > 7) level = 'firm';

      let paymentLink = cl.payment_link;
      if (!paymentLink) {
        const plResult = await pinelabsService.createPaymentLink(`CL-${cl.id}`, cl.amount);
        paymentLink = plResult.paymentLink;
      }

      await db('reminders').insert({
        invoice_id: cl.transaction_record_id || 0,
        customer_id: cl.buyer_id,
        escalation_level: level,
        channel: 'email',
        payment_link: paymentLink,
        status: 'sent',
        sent_at: now.toISOString(),
      });

      await db('action_logs').insert({
        merchant_id: cl.merchant_id,
        agent_type: 'collection_agent',
        decision_type: 'credit_line_escalation',
        inputs: JSON.stringify({ credit_line_id: cl.id, level, days_overdue: daysOverdue, payment_link: paymentLink, transaction_id: cl.transaction_record_id }),
        policy_rules_applied: null,
        outcome: `escalated_${level}`,
        reasoning: `Credit line ₹${cl.amount} is ${daysOverdue} days overdue. Escalated to ${level}.`,
        created_at: now.toISOString(),
      });

      results.push({ credit_line_id: cl.id, level, days_overdue: daysOverdue });
    }
  }

  return results;
}
