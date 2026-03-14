import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../db.js';
import { createDispute, verifyClaim, resolveDispute, reEvaluate, reviewArtifacts, manualResolution } from '../agents/deductionAgent.js';

const router = Router();

/**
 * GET /api/v1/disputes
 * List disputes with optional status/customer_id/merchant_id filters.
 * Requirements: 6.1
 */
router.get(
  '/',
  validate({
    query: {
      status: { required: false, type: 'string', oneOf: ['open', 'verifying', 'resolved', 'reopened'] },
      customer_id: { required: false, type: 'number' },
      merchant_id: { required: false, type: 'number' },
    },
  }),
  async (req, res, next) => {
    try {
      const query = db('disputes');
      if (req.query.status) query.where('status', req.query.status);
      if (req.query.customer_id) query.where('customer_id', Number(req.query.customer_id));
      if (req.query.merchant_id) query.where('merchant_id', Number(req.query.merchant_id));
      query.orderBy('created_at', 'desc');

      const disputes = await query;
      res.success(disputes);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/disputes/:id
 * Get dispute detail.
 * Requirements: 6.2
 */
router.get(
  '/:id',
  validate({
    params: { id: { required: true, type: 'number' } },
  }),
  async (req, res, next) => {
    try {
      const dispute = await db('disputes').where({ id: Number(req.params.id) }).first();
      if (!dispute) {
        throw new AppError(404, 'DISPUTE_NOT_FOUND', `Dispute with ID ${req.params.id} not found`);
      }
      // Attach artifacts and action logs if tables exist
      let artifacts = [];
      let action_logs = [];
      try {
        artifacts = await db('dispute_artifacts').where({ dispute_id: dispute.id }).orderBy('created_at', 'desc');
      } catch { /* table may not exist in test env */ }
      try {
        action_logs = await db('action_logs')
          .where({ agent_type: 'deduction' })
          .whereRaw("json_extract(inputs, '$.dispute_id') = ?", [dispute.id])
          .orderBy('created_at', 'desc')
          .limit(20);
      } catch { /* ignore */ }
      res.success({ ...dispute, artifacts, action_logs });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/disputes
 * Create a new dispute. Calls createDispute then verifyClaim.
 * Requirements: 6.1
 */
router.post(
  '/',
  validate({
    body: {
      merchant_id: { required: true, type: 'number' },
      customer_id: { required: true, type: 'number' },
      invoice_id: { required: true, type: 'number' },
      claim_details: { required: true, type: 'string' },
    },
  }),
  async (req, res, next) => {
    try {
      const { merchant_id, customer_id, invoice_id, claim_details } = req.body;
      const dispute = await createDispute({ merchant_id, customer_id, invoice_id, claim_details });
      const verification = await verifyClaim(dispute.id);
      res.success({ dispute, verification }, 201);
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return next(new AppError(404, 'NOT_FOUND', err.message));
      }
      if (err.message && err.message.includes('Missing required')) {
        return next(new AppError(400, 'VALIDATION_ERROR', err.message));
      }
      next(err);
    }
  }
);

/**
 * POST /api/v1/disputes/:id/resolve
 * Trigger autonomous resolution for a dispute.
 * Requirements: 7.1, 7.2, 7.6
 */
router.post(
  '/:id/resolve',
  validate({
    params: { id: { required: true, type: 'number' } },
  }),
  async (req, res, next) => {
    try {
      const result = await resolveDispute(Number(req.params.id));
      res.success(result);
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return next(new AppError(404, 'DISPUTE_NOT_FOUND', err.message));
      }
      if (err.message && err.message.includes('not verified')) {
        return next(new AppError(400, 'DISPUTE_NOT_VERIFIED', err.message));
      }
      next(err);
    }
  }
);

/**
 * POST /api/v1/disputes/:id/re-evaluate
 * Re-evaluate a dispute with new information.
 * Requirements: 7.4
 */
router.post(
  '/:id/re-evaluate',
  validate({
    params: { id: { required: true, type: 'number' } },
    body: {
      claim_details: { required: true, type: 'string' },
    },
  }),
  async (req, res, next) => {
    try {
      const result = await reEvaluate(Number(req.params.id), {
        claim_details: req.body.claim_details,
      });
      res.success(result);
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return next(new AppError(404, 'DISPUTE_NOT_FOUND', err.message));
      }
      if (err.message && err.message.includes('must include')) {
        return next(new AppError(400, 'VALIDATION_ERROR', err.message));
      }
      next(err);
    }
  }
);

// POST /:id/artifacts — upload dispute artifact
router.post('/:id/artifacts', async (req, res) => {
  try {
    const { id } = req.params;
    const dispute = await db('disputes').where({ id }).first();
    if (!dispute) return res.error('Dispute not found', 404);

    const { artifact_type, description, file_path } = req.body;
    if (!artifact_type) return res.error('Required: artifact_type', 400);

    const [artifactId] = await db('dispute_artifacts').insert({
      dispute_id: id, artifact_type, description, file_path,
      review_status: 'pending', created_at: new Date().toISOString(),
    });
    const artifact = await db('dispute_artifacts').where({ id: artifactId }).first();
    res.success(artifact, 201);
  } catch (err) {
    res.error(err.message, 500);
  }
});

// POST /:id/artifact-review — trigger AI artifact review
router.post('/:id/artifact-review', async (req, res) => {
  try {
    const result = await reviewArtifacts(parseInt(req.params.id));
    res.success(result);
  } catch (err) {
    const status = err.message.includes('not found') ? 404
      : err.message.includes('No artifacts') ? 400 : 500;
    res.error(err.message, status);
  }
});

// POST /:id/manual-resolve — merchant manual resolution
router.post('/:id/manual-resolve', async (req, res) => {
  try {
    const { resolution, merchant_notes } = req.body;
    if (!resolution) return res.error('Required: resolution', 400);
    const result = await manualResolution(parseInt(req.params.id), resolution, merchant_notes || '');
    res.success(result);
  } catch (err) {
    res.error(err.message, err.message.includes('not found') ? 404 : 500);
  }
});

export default router;
