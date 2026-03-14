import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import {
  getCashFlowSummary,
  getCashFlowTimeline,
  generatePredictions,
  getNetBalance,
} from '../engines/treasuryEngine.js';

const router = Router();

/**
 * GET /api/v1/treasury/cash-flow
 * Get cash flow summary for a time period.
 * Requirements: 11.1, 11.2
 */
router.get(
  '/cash-flow',
  validate({
    query: {
      merchant_id: { required: false, type: 'number' },
      start_date: { required: false, type: 'string' },
      end_date: { required: false, type: 'string' },
    },
  }),
  async (req, res, next) => {
    try {
      const merchantId = req.query.merchant_id ? Number(req.query.merchant_id) : 1;
      // Default to last 30 days if no dates provided
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const startDate = req.query.start_date || thirtyDaysAgo.toISOString();
      const endDate = req.query.end_date || now.toISOString();
      const summary = await getCashFlowSummary(merchantId, startDate, endDate);
      res.success(summary);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/treasury/transactions
 * List transactions timeline with running balance.
 * Requirements: 8.4
 */
router.get(
  '/transactions',
  validate({
    query: {
      merchant_id: { required: false, type: 'number' },
      start_date: { required: false, type: 'string' },
      end_date: { required: false, type: 'string' },
    },
  }),
  async (req, res, next) => {
    try {
      const merchantId = req.query.merchant_id ? Number(req.query.merchant_id) : 1;
      const period = {};
      if (req.query.start_date) period.startDate = req.query.start_date;
      if (req.query.end_date) period.endDate = req.query.end_date;
      const timeline = await getCashFlowTimeline(merchantId, period);
      res.success(timeline);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/treasury/predictions
 * Get cash flow predictions (90 days).
 * Requirements: 9.1, 9.4
 */
router.get(
  '/predictions',
  validate({
    query: {
      merchant_id: { required: false, type: 'number' },
    },
  }),
  async (req, res, next) => {
    try {
      const merchantId = req.query.merchant_id ? Number(req.query.merchant_id) : 1;
      const predictions = await generatePredictions(merchantId);
      res.success(predictions);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/treasury/net-balance
 * Get running net balance.
 * Requirements: 8.3
 */
router.get(
  '/net-balance',
  validate({
    query: {
      merchant_id: { required: false, type: 'number' },
    },
  }),
  async (req, res, next) => {
    try {
      const merchantId = req.query.merchant_id ? Number(req.query.merchant_id) : 1;
      const balance = await getNetBalance(merchantId);
      res.success(balance);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
