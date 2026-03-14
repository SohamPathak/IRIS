import db from '../db.js';
import pinelabsService from '../services/pinelabsService.js';

/**
 * Deduction Agent — Autonomous agent for handling disputes and refunds.
 *
 * Responsibilities:
 * - Create dispute records with claim details (Req 6.1)
 * - Verify claims by cross-referencing order data (Req 6.2, 6.3)
 * - Resolve disputes autonomously per policy rules (Req 7.1, 7.6)
 * - Process refunds via Pine Labs (Req 7.2)
 * - Record all actions and reasoning in action_log (Req 7.3)
 * - Re-evaluate disputes with new information (Req 7.4)
 * - Notify merchant with summary (Req 7.5)
 */

/**
 * Create a new dispute record in the database.
 *
 * @param {object} disputeData
 * @param {number} disputeData.merchant_id
 * @param {number} disputeData.customer_id
 * @param {number} disputeData.invoice_id
 * @param {string} disputeData.claim_details
 * @returns {Promise<object>} The created dispute record
 * Requirements: 6.1
 */
export async function createDispute(disputeData) {
  const { merchant_id, customer_id, invoice_id, claim_details } = disputeData;

  if (!merchant_id || !customer_id || !invoice_id || !claim_details) {
    throw new Error('Missing required dispute fields: merchant_id, customer_id, invoice_id, claim_details');
  }

  // Verify the invoice exists
  const invoice = await db('invoices').where({ id: invoice_id }).first();
  if (!invoice) {
    throw new Error(`Invoice with ID ${invoice_id} not found`);
  }

  const [dispute] = await db('disputes')
    .insert({
      merchant_id,
      customer_id,
      invoice_id,
      claim_details,
      status: 'open',
    })
    .returning('*');

  // Log the action (Req 7.3)
  await db('action_logs').insert({
    merchant_id,
    agent_type: 'deduction',
    decision_type: 'create_dispute',
    inputs: JSON.stringify({ customer_id, invoice_id, claim_details }),
    policy_rules_applied: JSON.stringify([]),
    outcome: `Created dispute #${dispute.id} for invoice #${invoice_id}`,
    reasoning: `Customer #${customer_id} raised a dispute for invoice #${invoice_id}. Claim: ${claim_details}`,
  });

  return dispute;
}


/**
 * Verify a dispute claim by cross-referencing order data.
 *
 * Checks:
 * - Invoice exists and belongs to the customer
 * - Invoice has line items (delivery proof proxy)
 * - Claim details are sufficiently detailed
 *
 * If missing info, sets verification_status to 'needs_info' and does NOT
 * proceed to resolution (Req 6.3).
 *
 * @param {number} disputeId
 * @returns {Promise<object>} Verification result
 * Requirements: 6.2, 6.3
 */
export async function verifyClaim(disputeId) {
  const dispute = await db('disputes').where({ id: disputeId }).first();
  if (!dispute) {
    throw new Error(`Dispute with ID ${disputeId} not found`);
  }

  // Update status to verifying
  await db('disputes').where({ id: disputeId }).update({ status: 'verifying' });

  const invoice = await db('invoices').where({ id: dispute.invoice_id }).first();
  const lineItems = await db('invoice_line_items').where({ invoice_id: dispute.invoice_id });

  const missingInfo = [];

  // Check if invoice exists and belongs to the customer
  if (!invoice) {
    missingInfo.push('Referenced invoice not found');
  } else if (invoice.customer_id !== dispute.customer_id) {
    missingInfo.push('Invoice does not belong to the disputing customer');
  }

  // Check for order details / delivery proof (line items serve as proxy)
  if (lineItems.length === 0) {
    missingInfo.push('No order line items found for verification');
  }

  // Check claim details are sufficiently detailed (at least 10 chars)
  if (!dispute.claim_details || dispute.claim_details.trim().length < 10) {
    missingInfo.push('Claim details are insufficient — please provide more detail');
  }

  let verificationStatus;
  let reasoning;

  if (missingInfo.length > 0) {
    // Missing info — set needs_info, do NOT proceed to resolution (Req 6.3)
    verificationStatus = 'needs_info';
    reasoning = `Verification incomplete. Missing: ${missingInfo.join('; ')}`;

    await db('disputes').where({ id: disputeId }).update({
      verification_status: 'needs_info',
    });
  } else {
    // Verified successfully
    verificationStatus = 'verified';
    reasoning = `Claim verified. Invoice #${dispute.invoice_id} confirmed for customer #${dispute.customer_id} with ${lineItems.length} line items.`;

    await db('disputes').where({ id: disputeId }).update({
      verification_status: 'verified',
    });
  }

  // Log the action (Req 7.3)
  await db('action_logs').insert({
    merchant_id: dispute.merchant_id,
    agent_type: 'deduction',
    decision_type: 'verify_claim',
    inputs: JSON.stringify({
      dispute_id: disputeId,
      invoice_id: dispute.invoice_id,
      customer_id: dispute.customer_id,
    }),
    policy_rules_applied: JSON.stringify([]),
    outcome: `Verification status: ${verificationStatus}`,
    reasoning,
  });

  return {
    disputeId,
    verificationStatus,
    missingInfo,
    reasoning,
  };
}


/**
 * Resolve a dispute autonomously based on policy rules.
 *
 * Only resolves disputes with verification_status='verified'.
 * Evaluates against active policy_rules for the merchant:
 * - condition_type='refund_threshold': auto-approve refunds at or below threshold (Req 7.6)
 * - Otherwise selects resolution based on claim and invoice data
 *
 * Processes refund via Pine Labs if resolution is full/partial refund (Req 7.2).
 * Notifies merchant with summary (Req 7.5).
 *
 * @param {number} disputeId
 * @returns {Promise<object>} Resolution result
 * Requirements: 7.1, 7.2, 7.3, 7.5, 7.6
 */
export async function resolveDispute(disputeId) {
  const dispute = await db('disputes').where({ id: disputeId }).first();
  if (!dispute) {
    throw new Error(`Dispute with ID ${disputeId} not found`);
  }

  if (dispute.verification_status !== 'verified') {
    throw new Error(`Dispute #${disputeId} is not verified (status: ${dispute.verification_status}). Cannot resolve.`);
  }

  const invoice = await db('invoices').where({ id: dispute.invoice_id }).first();
  if (!invoice) {
    throw new Error(`Invoice with ID ${dispute.invoice_id} not found`);
  }

  // Fetch active policy rules for this merchant
  const policyRules = await db('policy_rules')
    .where({ merchant_id: dispute.merchant_id, is_active: 1 })
    .select('*');

  // Check for refund_threshold auto-approve rule (Req 7.6)
  const refundThresholdRule = policyRules.find(
    (r) => r.condition_type === 'refund_threshold'
  );

  let resolutionType;
  let resolutionDetails;
  let appliedRules = [];
  let refundAmount = 0;

  if (refundThresholdRule) {
    let thresholdValue;
    try {
      const parsed = JSON.parse(refundThresholdRule.condition_value);
      thresholdValue = parsed.amount || parsed.threshold || Number(refundThresholdRule.condition_value);
    } catch {
      thresholdValue = Number(refundThresholdRule.condition_value);
    }

    appliedRules.push({ id: refundThresholdRule.id, name: refundThresholdRule.name });

    if (invoice.amount <= thresholdValue) {
      // Auto-approve full refund (Req 7.6)
      resolutionType = 'full_refund';
      refundAmount = invoice.amount;
      resolutionDetails = `Auto-approved full refund of ₹${invoice.amount} (within threshold ₹${thresholdValue})`;
    } else {
      // Above threshold — evaluate further
      // Default to partial refund at 50% for amounts above threshold
      resolutionType = 'partial_refund';
      refundAmount = Math.round(invoice.amount * 0.5 * 100) / 100;
      resolutionDetails = `Invoice amount ₹${invoice.amount} exceeds auto-approve threshold ₹${thresholdValue}. Partial refund of ₹${refundAmount} approved.`;
    }
  } else {
    // No refund threshold rule — default resolution logic
    // Full refund for verified claims
    resolutionType = 'full_refund';
    refundAmount = invoice.amount;
    resolutionDetails = `No refund threshold policy found. Full refund of ₹${invoice.amount} approved based on verified claim.`;
  }

  // Process refund via Pine Labs if applicable (Req 7.2)
  let refundResult = null;
  if (resolutionType === 'full_refund' || resolutionType === 'partial_refund') {
    refundResult = await processRefund(disputeId, refundAmount);
  }

  // Update dispute record
  await db('disputes').where({ id: disputeId }).update({
    status: 'resolved',
    resolution_type: resolutionType,
    resolution_details: resolutionDetails,
    resolved_at: new Date().toISOString(),
  });

  const reasoning = `Evaluated dispute #${disputeId} for invoice #${dispute.invoice_id} (₹${invoice.amount}). ` +
    `Applied ${appliedRules.length} policy rule(s). Resolution: ${resolutionType}. ${resolutionDetails}`;

  // Log the action (Req 7.3)
  await db('action_logs').insert({
    merchant_id: dispute.merchant_id,
    agent_type: 'deduction',
    decision_type: 'resolve_dispute',
    inputs: JSON.stringify({
      dispute_id: disputeId,
      invoice_id: dispute.invoice_id,
      invoice_amount: invoice.amount,
    }),
    policy_rules_applied: JSON.stringify(appliedRules),
    outcome: `Resolved as ${resolutionType}. Refund: ₹${refundAmount}`,
    reasoning,
  });

  // Notify merchant with summary (Req 7.5) — logged as action
  await db('action_logs').insert({
    merchant_id: dispute.merchant_id,
    agent_type: 'deduction',
    decision_type: 'merchant_notification',
    inputs: JSON.stringify({ dispute_id: disputeId }),
    policy_rules_applied: JSON.stringify([]),
    outcome: `Merchant notified of dispute #${disputeId} resolution`,
    reasoning: `Dispute #${disputeId} resolved as ${resolutionType}. Customer #${dispute.customer_id}, Invoice #${dispute.invoice_id}. ${resolutionDetails}`,
  });

  return {
    disputeId,
    resolutionType,
    resolutionDetails,
    refundAmount,
    refundResult,
    appliedRules,
  };
}


/**
 * Process a refund for a dispute via Pine Labs and record the transaction.
 *
 * @param {number} disputeId
 * @param {number} amount - Refund amount in INR
 * @returns {Promise<object>} Refund result with transaction record
 * Requirements: 7.2
 */
export async function processRefund(disputeId, amount) {
  const dispute = await db('disputes').where({ id: disputeId }).first();
  if (!dispute) {
    throw new Error(`Dispute with ID ${disputeId} not found`);
  }

  if (typeof amount !== 'number' || amount <= 0) {
    throw new Error('Refund amount must be a positive number');
  }

  // Find the original payment transaction for this invoice
  const originalTx = await db('transactions')
    .where({ reference_type: 'invoice', reference_id: dispute.invoice_id, type: 'incoming' })
    .first();

  const transactionRef = originalTx?.pine_labs_ref || `DISPUTE-${disputeId}`;

  // Process refund via Pine Labs (Req 7.2)
  const refundResult = await pinelabsService.processRefund(transactionRef, amount);

  // Record outgoing transaction
  const [transaction] = await db('transactions')
    .insert({
      merchant_id: dispute.merchant_id,
      type: 'outgoing',
      amount,
      reference_type: 'dispute',
      reference_id: disputeId,
      pine_labs_ref: refundResult.refundRef,
    })
    .returning('*');

  // Log the action (Req 7.3)
  await db('action_logs').insert({
    merchant_id: dispute.merchant_id,
    agent_type: 'deduction',
    decision_type: 'process_refund',
    inputs: JSON.stringify({
      dispute_id: disputeId,
      amount,
      transaction_ref: transactionRef,
    }),
    policy_rules_applied: JSON.stringify([]),
    outcome: `Refund of ₹${amount} processed. Ref: ${refundResult.refundRef}`,
    reasoning: `Processed refund of ₹${amount} for dispute #${disputeId} via Pine Labs. Transaction ref: ${refundResult.refundRef}.`,
  });

  return {
    refundRef: refundResult.refundRef,
    amount,
    transaction,
  };
}

/**
 * Re-evaluate a dispute with new information provided by the customer.
 *
 * Reopens the dispute, updates claim details, re-verifies, and re-resolves.
 *
 * @param {number} disputeId
 * @param {object} newInfo
 * @param {string} [newInfo.claim_details] - Updated claim details
 * @returns {Promise<object>} Re-evaluation result
 * Requirements: 7.4
 */
export async function reEvaluate(disputeId, newInfo) {
  const dispute = await db('disputes').where({ id: disputeId }).first();
  if (!dispute) {
    throw new Error(`Dispute with ID ${disputeId} not found`);
  }

  if (!newInfo || (!newInfo.claim_details)) {
    throw new Error('New information must include claim_details');
  }

  // Reopen the dispute
  const updates = {
    status: 'reopened',
    verification_status: null,
    resolution_type: null,
    resolution_details: null,
    resolved_at: null,
  };

  if (newInfo.claim_details) {
    updates.claim_details = newInfo.claim_details;
  }

  await db('disputes').where({ id: disputeId }).update(updates);

  // Log the re-evaluation action (Req 7.3)
  await db('action_logs').insert({
    merchant_id: dispute.merchant_id,
    agent_type: 'deduction',
    decision_type: 're_evaluate_dispute',
    inputs: JSON.stringify({
      dispute_id: disputeId,
      new_info: newInfo,
      previous_resolution: dispute.resolution_type,
    }),
    policy_rules_applied: JSON.stringify([]),
    outcome: `Dispute #${disputeId} reopened for re-evaluation`,
    reasoning: `Customer provided new information for dispute #${disputeId}. Previous resolution: ${dispute.resolution_type || 'none'}. Reopening for re-verification and resolution.`,
  });

  // Re-verify with updated info
  const verificationResult = await verifyClaim(disputeId);

  // If verified, re-resolve
  let resolutionResult = null;
  if (verificationResult.verificationStatus === 'verified') {
    resolutionResult = await resolveDispute(disputeId);
  }

  return {
    disputeId,
    verificationResult,
    resolutionResult,
  };
}

// --- Artifact Review (Bedrock integration) ---
// Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6

import bedrockService from '../services/bedrockService.js';

/**
 * Review dispute artifacts using Bedrock AI.
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.6
 */
export async function reviewArtifacts(disputeId) {
  const dispute = await db('disputes').where({ id: disputeId }).first();
  if (!dispute) throw new Error('Dispute not found');

  // Fetch artifacts
  const artifacts = await db('dispute_artifacts').where({ dispute_id: disputeId });
  if (artifacts.length === 0) throw new Error('No artifacts found for this dispute');

  // Fetch active policy rules
  const policyRules = await db('policy_rules')
    .where({ merchant_id: dispute.merchant_id, is_active: 1 });

  // Send to Bedrock for review
  const artifactDescriptions = artifacts.map(a => ({
    type: a.artifact_type,
    description: a.description || '',
  }));

  const assessment = await bedrockService.reviewArtifacts(
    { claim_details: dispute.claim_details, amount: dispute.amount || 0, status: dispute.status },
    artifactDescriptions,
    policyRules,
  );

  // Update artifact review statuses
  for (const artifact of artifacts) {
    await db('dispute_artifacts').where({ id: artifact.id }).update({
      review_status: 'reviewed',
      review_assessment: JSON.stringify(assessment),
    });
  }

  // Apply recommendation if policy-aligned
  let resolution = null;
  if (assessment.policyAligned && assessment.recommendedResolution !== 'rejection') {
    await db('disputes').where({ id: disputeId }).update({
      resolution_type: assessment.recommendedResolution,
      resolution_details: assessment.reasoning,
      status: 'resolved',
      resolved_at: new Date().toISOString(),
    });

    // Process refund for valid deductions
    if (assessment.validity && (assessment.recommendedResolution === 'full_refund' || assessment.recommendedResolution === 'partial_refund')) {
      const invoice = await db('invoices').where({ id: dispute.invoice_id }).first();
      const refundAmount = assessment.recommendedResolution === 'full_refund'
        ? (invoice?.amount || 0)
        : (invoice?.amount || 0) * 0.5;

      if (refundAmount > 0) {
        const refundResult = await pinelabsService.processRefund(`DISPUTE-${disputeId}`, refundAmount);
        await db('transactions').insert({
          merchant_id: dispute.merchant_id,
          type: 'outgoing',
          amount: refundAmount,
          reference_type: 'dispute',
          reference_id: disputeId,
          pine_labs_ref: refundResult.refundRef,
          created_at: new Date().toISOString(),
        });
        resolution = { type: assessment.recommendedResolution, amount: refundAmount, refundRef: refundResult.refundRef };
      }
    }
  }

  // Log to action_log
  await db('action_logs').insert({
    merchant_id: dispute.merchant_id,
    agent_type: 'deduction',
    decision_type: 'artifact_review',
    inputs: JSON.stringify({
      dispute_id: disputeId,
      artifacts_count: artifacts.length,
      assessment,
      resolution,
    }),
    policy_rules_applied: JSON.stringify(policyRules.map(r => r.name)),
    outcome: assessment.recommendedResolution,
    reasoning: `Artifact review: ${assessment.supportLevel} support. ${assessment.policyAligned ? 'Policy-aligned.' : 'Policy conflict — not auto-applied.'}`,
    created_at: new Date().toISOString(),
  });

  return { assessment, resolution, artifacts_reviewed: artifacts.length };
}

/**
 * Manual resolution — merchant override of artifact review.
 * Requirements: 7.5
 */
export async function manualResolution(disputeId, resolution, merchantNotes) {
  const dispute = await db('disputes').where({ id: disputeId }).first();
  if (!dispute) throw new Error('Dispute not found');

  await db('disputes').where({ id: disputeId }).update({
    resolution_type: resolution,
    resolution_details: merchantNotes,
    status: 'resolved',
    resolved_at: new Date().toISOString(),
  });

  // Update artifact review status to manual_override
  await db('dispute_artifacts').where({ dispute_id: disputeId }).update({
    review_status: 'manual_override',
  });

  // Process refund if resolution is a refund type
  let refundResult = null;
  if (resolution === 'full_refund' || resolution === 'partial_refund') {
    const invoice = await db('invoices').where({ id: dispute.invoice_id }).first();
    const refundAmount = resolution === 'full_refund'
      ? (invoice?.amount || 0)
      : (invoice?.amount || 0) * 0.5;

    if (refundAmount > 0) {
      refundResult = await pinelabsService.processRefund(`DISPUTE-MANUAL-${disputeId}`, refundAmount);
      await db('transactions').insert({
        merchant_id: dispute.merchant_id,
        type: 'outgoing',
        amount: refundAmount,
        reference_type: 'dispute',
        reference_id: disputeId,
        pine_labs_ref: refundResult.refundRef,
        created_at: new Date().toISOString(),
      });
    }
  }

  await db('action_logs').insert({
    merchant_id: dispute.merchant_id,
    agent_type: 'deduction',
    decision_type: 'manual_resolution',
    inputs: JSON.stringify({ dispute_id: disputeId, resolution, merchant_notes: merchantNotes }),
    policy_rules_applied: null,
    outcome: resolution,
    reasoning: `Manual resolution by merchant: ${resolution}. Notes: ${merchantNotes}`,
    created_at: new Date().toISOString(),
  });

  return { dispute_id: disputeId, resolution, refundResult };
}
