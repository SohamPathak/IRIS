import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../db.js';
import pinelabsService from '../services/pinelabsService.js';

const router = Router();
const publicRouter = Router();

const VALID_EVENT_TYPES = ['payment', 'refund', 'dispute', 'threat'];

/**
 * POST /api/v1/webhooks/subscribe
 * Subscribe to webhook events.
 * Requirements: 18.3
 */
router.post(
  '/subscribe',
  validate({
    body: {
      merchant_id: { required: true, type: 'number' },
      event_type: { required: true, type: 'string', oneOf: VALID_EVENT_TYPES },
      callback_url: { required: true, type: 'string' },
    },
  }),
  async (req, res, next) => {
    try {
      const { merchant_id, event_type, callback_url, api_key } = req.body;

      const now = new Date().toISOString();
      const [id] = await db('webhook_subscriptions').insert({
        merchant_id,
        event_type,
        callback_url,
        api_key: api_key || null,
        is_active: 1,
        created_at: now,
      });

      const subscription = await db('webhook_subscriptions').where({ id }).first();
      res.success(subscription, 201);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/webhooks/:id
 * Unsubscribe from webhook events.
 * Requirements: 18.3
 */
router.delete(
  '/:id',
  validate({
    params: { id: { required: true, type: 'number' } },
  }),
  async (req, res, next) => {
    try {
      const subId = Number(req.params.id);
      const existing = await db('webhook_subscriptions').where({ id: subId }).first();
      if (!existing) {
        throw new AppError(404, 'WEBHOOK_NOT_FOUND', `Webhook subscription with ID ${subId} not found`);
      }

      await db('webhook_subscriptions').where({ id: subId }).del();
      res.success({ deleted: true, id: subId });
    } catch (err) {
      if (err instanceof AppError) return next(err);
      next(err);
    }
  }
);

/**
 * POST /api/v1/webhooks/pine-labs/callback
 * Handles Pine Labs payment confirmation callback.
 * This endpoint does NOT require API key auth — it's called by Pine Labs externally.
 * Requirements: 16.4
 */
publicRouter.post('/pine-labs/callback', async (req, res, next) => {
  try {
    const payload = req.body;

    // Validate callback payload via Pine Labs service
    const validation = await pinelabsService.validateCallback(payload);
    if (!validation.valid) {
      throw new AppError(400, 'INVALID_CALLBACK', 'Invalid Pine Labs callback payload', {
        errors: validation.errors,
      });
    }

    const { invoice_id, amount, transaction_id, status } = payload;

    // Look up the invoice
    const invoice = await db('invoices').where({ id: invoice_id }).first();
    if (!invoice) {
      throw new AppError(404, 'INVOICE_NOT_FOUND', `Invoice with ID ${invoice_id} not found`);
    }

    if (status === 'success') {
      // Update invoice to paid, balance_due to 0
      const now = new Date().toISOString();
      await db('invoices').where({ id: invoice_id }).update({
        status: 'paid',
        balance_due: 0,
        paid_at: now,
      });

      // Record status history
      await db('invoice_status_history').insert({
        invoice_id,
        old_status: invoice.status,
        new_status: 'paid',
        changed_at: now,
        reason: `Payment confirmed via Pine Labs callback (ref: ${transaction_id})`,
      });

      // Record transaction (incoming)
      await db('transactions').insert({
        merchant_id: invoice.merchant_id,
        type: 'incoming',
        amount,
        reference_type: 'invoice',
        reference_id: invoice_id,
        pine_labs_ref: transaction_id,
        created_at: now,
      });
    }

    res.success({
      received: true,
      invoice_id,
      status,
    });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(err);
  }
});

export default router;
export { publicRouter as webhookPublicRouter };
