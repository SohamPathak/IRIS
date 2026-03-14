import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../db.js';
import { offerPaymentPlan, handleMissedInstallments } from '../agents/collectionAgent.js';

const router = Router();

/**
 * GET /api/v1/payment-plans
 * List payment plans with optional filters.
 * Requirements: 4.4
 */
router.get(
  '/',
  validate({
    query: {
      invoice_id: { required: false, type: 'number' },
      customer_id: { required: false, type: 'number' },
      status: { required: false, type: 'string', oneOf: ['active', 'completed', 'defaulted'] },
    },
  }),
  async (req, res, next) => {
    try {
      const query = db('payment_plans').select('*').orderBy('created_at', 'desc');

      if (req.query.invoice_id) query.where('invoice_id', Number(req.query.invoice_id));
      if (req.query.customer_id) query.where('customer_id', Number(req.query.customer_id));
      if (req.query.status) query.where('status', req.query.status);

      const plans = await query;

      // Attach installments for each plan
      const result = [];
      for (const plan of plans) {
        const installments = await db('installments')
          .where({ payment_plan_id: plan.id })
          .orderBy('installment_number', 'asc');
        result.push({ ...plan, installments });
      }

      res.success(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/payment-plans
 * Create a payment plan for an overdue invoice (calls offerPaymentPlan).
 * Requirements: 4.1, 4.2
 */
router.post(
  '/',
  validate({
    body: {
      invoice_id: { required: true, type: 'number' },
    },
  }),
  async (req, res, next) => {
    try {
      const result = await offerPaymentPlan(req.body.invoice_id);

      if (!result.offered) {
        throw new AppError(400, 'PAYMENT_PLAN_NOT_OFFERED', result.reason);
      }

      res.success({ plan: result.plan, installments: result.installments }, 201);
    } catch (err) {
      if (err instanceof AppError) return next(err);
      if (err.message && err.message.includes('not found')) {
        return next(new AppError(404, 'INVOICE_NOT_FOUND', err.message));
      }
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/payment-plans/:id/installments/:installmentId/pay
 * Record payment for a specific installment.
 * Requirements: 4.3
 */
router.patch(
  '/:id/installments/:installmentId/pay',
  validate({
    params: {
      id: { required: true, type: 'number' },
      installmentId: { required: true, type: 'number' },
    },
  }),
  async (req, res, next) => {
    try {
      const planId = Number(req.params.id);
      const installmentId = Number(req.params.installmentId);

      const plan = await db('payment_plans').where({ id: planId }).first();
      if (!plan) {
        throw new AppError(404, 'PLAN_NOT_FOUND', `Payment plan with ID ${planId} not found`);
      }

      const installment = await db('installments')
        .where({ id: installmentId, payment_plan_id: planId })
        .first();
      if (!installment) {
        throw new AppError(404, 'INSTALLMENT_NOT_FOUND', `Installment with ID ${installmentId} not found in plan ${planId}`);
      }

      if (installment.status === 'paid') {
        throw new AppError(400, 'ALREADY_PAID', 'This installment has already been paid');
      }

      const now = new Date().toISOString();

      await db('installments')
        .where({ id: installmentId })
        .update({ status: 'paid', paid_at: now });

      // Check if all installments are now paid
      const pendingCount = await db('installments')
        .where({ payment_plan_id: planId })
        .whereNot({ status: 'paid' })
        .whereNot({ id: installmentId })
        .count('* as count')
        .first();

      if (pendingCount.count === 0) {
        await db('payment_plans')
          .where({ id: planId })
          .update({ status: 'completed' });
      }

      const updated = await db('installments').where({ id: installmentId }).first();
      const updatedPlan = await db('payment_plans').where({ id: planId }).first();

      res.success({ plan: updatedPlan, installment: updated });
    } catch (err) {
      if (err instanceof AppError) return next(err);
      next(err);
    }
  }
);

export default router;
