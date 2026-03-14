import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import * as Invoice from '../models/invoice.js';

const router = Router();

/**
 * GET /api/v1/invoices
 * List invoices with optional status/date/customer/merchant filters.
 * Requirements: 1.4
 */
router.get(
  '/',
  validate({
    query: {
      status: { required: false, type: 'string', oneOf: ['pending', 'overdue', 'paid', 'partial'] },
      merchant_id: { required: false, type: 'number' },
      customer_id: { required: false, type: 'number' },
      date_from: { required: false, type: 'string' },
      date_to: { required: false, type: 'string' },
    },
  }),
  async (req, res, next) => {
    try {
      const filters = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.merchant_id) filters.merchant_id = Number(req.query.merchant_id);
      if (req.query.customer_id) filters.customer_id = Number(req.query.customer_id);
      if (req.query.date_from) filters.date_from = req.query.date_from;
      if (req.query.date_to) filters.date_to = req.query.date_to;

      const invoices = await Invoice.findAll(filters);
      res.success(invoices);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/invoices/:id
 * Get invoice detail with line items and status history.
 * Requirements: 1.6
 */
router.get(
  '/:id',
  validate({
    params: { id: { required: true, type: 'number' } },
  }),
  async (req, res, next) => {
    try {
      const invoice = await Invoice.findById(Number(req.params.id));
      if (!invoice) {
        throw new AppError(404, 'INVOICE_NOT_FOUND', `Invoice with ID ${req.params.id} not found`);
      }
      res.success(invoice);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/invoices
 * Create a new invoice with line items.
 * Requirements: 1.1
 */
router.post(
  '/',
  validate({
    body: {
      merchant_id: { required: true, type: 'number' },
      customer_id: { required: true, type: 'number' },
      amount: { required: true, type: 'number', min: 0 },
      due_date: { required: true, type: 'string' },
    },
  }),
  async (req, res, next) => {
    try {
      const { merchant_id, customer_id, amount, due_date, line_items } = req.body;
      const invoice = await Invoice.create({
        merchant_id,
        customer_id,
        amount,
        due_date,
        line_items: line_items || [],
      });
      res.success(invoice, 201);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/invoices/:id/pay
 * Record full payment for an invoice.
 * Requirements: 1.2
 */
router.patch(
  '/:id/pay',
  validate({
    params: { id: { required: true, type: 'number' } },
  }),
  async (req, res, next) => {
    try {
      const invoice = await Invoice.recordFullPayment(Number(req.params.id));
      res.success(invoice);
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return next(new AppError(404, 'INVOICE_NOT_FOUND', `Invoice with ID ${req.params.id} not found`));
      }
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/invoices/:id/partial-pay
 * Record partial payment for an invoice.
 * Requirements: 1.5
 */
router.patch(
  '/:id/partial-pay',
  validate({
    params: { id: { required: true, type: 'number' } },
    body: {
      amount: { required: true, type: 'number', min: 0.01 },
    },
  }),
  async (req, res, next) => {
    try {
      const invoice = await Invoice.recordPartialPayment(Number(req.params.id), req.body.amount);
      res.success(invoice);
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return next(new AppError(404, 'INVOICE_NOT_FOUND', `Invoice with ID ${req.params.id} not found`));
      }
      if (err.message && (err.message.includes('greater than 0') || err.message.includes('Use recordFullPayment'))) {
        return next(new AppError(400, 'INVALID_PAYMENT', err.message));
      }
      next(err);
    }
  }
);

export default router;
