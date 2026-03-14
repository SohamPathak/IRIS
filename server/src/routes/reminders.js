import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import db from '../db.js';
import { evaluateOverdueInvoices, escalateReminders } from '../agents/collectionAgent.js';

const router = Router();

/**
 * GET /api/v1/reminders
 * List reminders with optional filters: invoice_id, customer_id, escalation_level, status, channel.
 * Requirements: 2.5
 */
router.get(
  '/',
  validate({
    query: {
      invoice_id: { required: false, type: 'number' },
      customer_id: { required: false, type: 'number' },
      escalation_level: { required: false, type: 'string', oneOf: ['friendly', 'firm', 'final'] },
      status: { required: false, type: 'string', oneOf: ['sent', 'responded'] },
      channel: { required: false, type: 'string', oneOf: ['email', 'sms', 'whatsapp'] },
    },
  }),
  async (req, res, next) => {
    try {
      const query = db('reminders').select('*').orderBy('sent_at', 'desc');

      if (req.query.invoice_id) query.where('invoice_id', Number(req.query.invoice_id));
      if (req.query.customer_id) query.where('customer_id', Number(req.query.customer_id));
      if (req.query.escalation_level) query.where('escalation_level', req.query.escalation_level);
      if (req.query.status) query.where('status', req.query.status);
      if (req.query.channel) query.where('channel', req.query.channel);

      const reminders = await query;
      res.success(reminders);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/reminders/trigger
 * Trigger reminder evaluation: marks overdue invoices and sends/escalates reminders.
 * Requirements: 2.1, 2.2, 2.3
 */
router.post('/trigger', async (req, res, next) => {
  try {
    const overdueResult = await evaluateOverdueInvoices();
    const escalationResult = await escalateReminders();

    res.success({
      marked_overdue: overdueResult.markedOverdue,
      reminders_sent: overdueResult.remindersSent,
      escalated: escalationResult.escalated,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
