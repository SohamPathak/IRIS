import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import db from '../db.js';
import { evaluateThreats } from '../engines/threatDetector.js';

const router = Router();

/**
 * GET /api/v1/threats
 * List active threats with severity.
 * Requirements: 10.5
 */
router.get(
  '/',
  validate({
    query: {
      merchant_id: { required: false, type: 'number' },
      severity: { required: false, type: 'string', oneOf: ['low', 'medium', 'high', 'critical'] },
      status: { required: false, type: 'string', oneOf: ['active', 'acknowledged', 'resolved'] },
    },
  }),
  async (req, res, next) => {
    try {
      const query = db('threats');
      const merchantId = req.query.merchant_id ? Number(req.query.merchant_id) : 1;
      query.where('merchant_id', merchantId);
      if (req.query.severity) query.where('severity', req.query.severity);
      if (req.query.status) query.where('status', req.query.status);
      query.orderBy('created_at', 'desc');

      const threats = await query;
      res.success(threats);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/threats/evaluate
 * Trigger threat evaluation across all merchants and customers.
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */
router.post('/evaluate', async (req, res, next) => {
  try {
    const threats = await evaluateThreats();
    res.success(threats);
  } catch (err) {
    next(err);
  }
});

export default router;
