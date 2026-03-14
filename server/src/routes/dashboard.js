import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import db from '../db.js';
import { generateSummary } from '../engines/summaryGenerator.js';

const router = Router();

/**
 * GET /api/v1/dashboard/summary
 * Get quick summary — AI-generated natural language overview of merchant financial health.
 * Requirements: 14.1, 14.2
 */
router.get(
  '/summary',
  validate({
    query: {
      merchant_id: { required: false, type: 'number' },
    },
  }),
  async (req, res, next) => {
    try {
      const merchantId = req.query.merchant_id ? Number(req.query.merchant_id) : 1;
      const summary = await generateSummary(merchantId);
      res.success(summary);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/dashboard/metrics
 * Get key metric cards: total receivables, total collected, total refunded, net position, collection rate.
 * Requirements: 11.4
 */
router.get(
  '/metrics',
  validate({
    query: {
      merchant_id: { required: false, type: 'number' },
    },
  }),
  async (req, res, next) => {
    try {
      const merchantId = req.query.merchant_id ? Number(req.query.merchant_id) : 1;

      // Total receivables: sum of balance_due for all non-paid invoices
      const receivablesResult = await db('invoices')
        .where({ merchant_id: merchantId })
        .whereNot({ status: 'paid' })
        .sum('balance_due as total_receivables')
        .first();
      const totalReceivables = receivablesResult?.total_receivables || 0;

      // Total collected: sum of incoming transactions
      const collectedResult = await db('transactions')
        .where({ merchant_id: merchantId, type: 'incoming' })
        .sum('amount as total_collected')
        .first();
      const totalCollected = collectedResult?.total_collected || 0;

      // Total refunded: sum of outgoing transactions
      const refundedResult = await db('transactions')
        .where({ merchant_id: merchantId, type: 'outgoing' })
        .sum('amount as total_refunded')
        .first();
      const totalRefunded = refundedResult?.total_refunded || 0;

      // Net position: total_collected - total_refunded
      const netPosition = totalCollected - totalRefunded;

      // Collection rate: (total_collected / (total_collected + total_receivables)) * 100
      const denominator = totalCollected + totalReceivables;
      const collectionRate = denominator > 0
        ? Math.round((totalCollected / denominator) * 10000) / 100
        : 0;

      res.success({
        total_receivables: totalReceivables,
        total_collected: totalCollected,
        total_refunded: totalRefunded,
        net_position: netPosition,
        collection_rate: collectionRate,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/dashboard/action-log
 * Get action log entries with filtering by agent type, decision type, and date range.
 * Results ordered by created_at DESC (most recent first).
 * Requirements: 13.1, 13.2
 */
router.get(
  '/action-log',
  validate({
    query: {
      merchant_id: { required: false, type: 'number' },
      agent_type: { required: false, type: 'string', oneOf: ['collection_agent', 'deduction_agent'] },
      decision_type: { required: false, type: 'string' },
      start_date: { required: false, type: 'string' },
      end_date: { required: false, type: 'string' },
    },
  }),
  async (req, res, next) => {
    try {
      const merchantId = req.query.merchant_id ? Number(req.query.merchant_id) : 1;
      const query = db('action_logs').where('merchant_id', merchantId);

      if (req.query.agent_type) query.where('agent_type', req.query.agent_type);
      if (req.query.decision_type) query.where('decision_type', req.query.decision_type);
      if (req.query.start_date) query.where('created_at', '>=', req.query.start_date);
      if (req.query.end_date) query.where('created_at', '<=', req.query.end_date);

      query.orderBy('created_at', 'desc');

      const logs = await query;
      res.success(logs);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
