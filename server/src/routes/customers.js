import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../db.js';
import { computeCustomerRiskScore } from '../agents/collectionAgent.js';

const router = Router();

/**
 * GET /api/v1/customers
 * List customers with risk scores. Optional merchant_id and risk_category filters.
 * Requirements: 12.1
 */
router.get(
  '/',
  validate({
    query: {
      merchant_id: { required: false, type: 'number' },
      risk_category: { required: false, type: 'string', oneOf: ['low', 'medium', 'high'] },
    },
  }),
  async (req, res, next) => {
    try {
      const query = db('customers')
        .select('*')
        .orderBy('risk_score', 'desc');

      if (req.query.merchant_id) query.where('merchant_id', Number(req.query.merchant_id));
      if (req.query.risk_category) query.where('risk_category', req.query.risk_category);

      const customers = await query;
      res.success(customers);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/customers/:id
 * Get customer detail with risk profile, invoice summary, and payment plans.
 * Requirements: 5.4, 12.2
 */
router.get(
  '/:id',
  validate({
    params: { id: { required: true, type: 'number' } },
  }),
  async (req, res, next) => {
    try {
      const customerId = Number(req.params.id);
      const customer = await db('customers').where({ id: customerId }).first();
      if (!customer) {
        throw new AppError(404, 'CUSTOMER_NOT_FOUND', `Customer with ID ${customerId} not found`);
      }

      // Invoice summary by status
      const invoices = await db('invoices')
        .where({ customer_id: customerId })
        .select('*');

      const invoiceSummary = {
        total: invoices.length,
        pending: invoices.filter((i) => i.status === 'pending').length,
        overdue: invoices.filter((i) => i.status === 'overdue').length,
        paid: invoices.filter((i) => i.status === 'paid').length,
        partial: invoices.filter((i) => i.status === 'partial').length,
        total_outstanding: invoices
          .filter((i) => ['pending', 'overdue', 'partial'].includes(i.status))
          .reduce((sum, i) => sum + i.balance_due, 0),
      };

      // Active payment plans
      const paymentPlans = await db('payment_plans')
        .where({ customer_id: customerId })
        .select('*');

      // Recent reminders
      const reminders = await db('reminders')
        .where({ customer_id: customerId })
        .orderBy('sent_at', 'desc')
        .limit(10);

      res.success({
        ...customer,
        invoice_summary: invoiceSummary,
        payment_plans: paymentPlans,
        recent_reminders: reminders,
      });
    } catch (err) {
      if (err instanceof AppError) return next(err);
      next(err);
    }
  }
);

/**
 * GET /api/v1/customers/:id/risk-history
 * Get risk score change history from action logs.
 * Requirements: 12.2
 */
router.get(
  '/:id/risk-history',
  validate({
    params: { id: { required: true, type: 'number' } },
  }),
  async (req, res, next) => {
    try {
      const customerId = Number(req.params.id);
      const customer = await db('customers').where({ id: customerId }).first();
      if (!customer) {
        throw new AppError(404, 'CUSTOMER_NOT_FOUND', `Customer with ID ${customerId} not found`);
      }

      // Get risk-related action logs for this customer
      const riskLogs = await db('action_logs')
        .where('decision_type', 'flag_high_risk')
        .whereRaw("json_extract(inputs, '$.customer_id') = ?", [customerId])
        .orderBy('created_at', 'desc');

      // Parse inputs to extract risk score history
      const history = riskLogs.map((log) => {
        let inputs = {};
        try { inputs = JSON.parse(log.inputs); } catch { /* ignore */ }
        return {
          id: log.id,
          risk_score: inputs.risk_score,
          total_overdue: inputs.total_overdue,
          threshold: inputs.threshold,
          outcome: log.outcome,
          reasoning: log.reasoning,
          created_at: log.created_at,
        };
      });

      res.success({
        customer_id: customerId,
        current_risk_score: customer.risk_score,
        current_risk_category: customer.risk_category,
        history,
      });
    } catch (err) {
      if (err instanceof AppError) return next(err);
      next(err);
    }
  }
);

export default router;
