import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../db.js';

const router = Router();

const VALID_CONDITION_TYPES = ['refund_threshold', 'emi_eligibility', 'reminder_timing', 'risk_threshold'];

/**
 * GET /api/v1/policies/templates
 * Get rule templates for common scenarios.
 * Requirements: 15.4
 */
router.get('/templates', async (_req, res, next) => {
  try {
    const templates = [
      {
        name: 'Auto-approve refunds under ₹X',
        condition_type: 'refund_threshold',
        condition_value: JSON.stringify({ amount: 500 }),
        action_type: 'auto_approve',
        action_value: JSON.stringify({ approve: true }),
        description: 'Automatically approve refund requests at or below the specified amount without additional review.',
      },
      {
        name: 'Offer EMI if overdue > N days',
        condition_type: 'emi_eligibility',
        condition_value: JSON.stringify({ overdue_days: 30 }),
        action_type: 'offer_emi',
        action_value: JSON.stringify({ installments: 3 }),
        description: 'Offer an EMI payment plan to customers whose invoices are overdue beyond the specified number of days.',
      },
      {
        name: 'Send first reminder after N days overdue',
        condition_type: 'reminder_timing',
        condition_value: JSON.stringify({ days_after_due: 1 }),
        action_type: 'send_reminder',
        action_value: JSON.stringify({ channel: 'email' }),
        description: 'Send the first friendly reminder after the specified number of days past the invoice due date.',
      },
      {
        name: 'Flag high-risk if overdue amount > ₹X',
        condition_type: 'risk_threshold',
        condition_value: JSON.stringify({ amount: 10000 }),
        action_type: 'flag_risk',
        action_value: JSON.stringify({ risk_level: 'high' }),
        description: 'Flag a customer as high-risk when their total overdue amount exceeds the specified threshold.',
      },
    ];
    res.success(templates);
  } catch (err) {
    next(err);
  }
});


/**
 * GET /api/v1/policies
 * List policy rules with optional merchant_id and condition_type filters.
 * Requirements: 15.1
 */
router.get(
  '/',
  validate({
    query: {
      merchant_id: { required: false, type: 'number' },
      condition_type: { required: false, type: 'string', oneOf: VALID_CONDITION_TYPES },
      is_active: { required: false, type: 'string', oneOf: ['0', '1'] },
    },
  }),
  async (req, res, next) => {
    try {
      const query = db('policy_rules');
      if (req.query.merchant_id) query.where('merchant_id', Number(req.query.merchant_id));
      if (req.query.condition_type) query.where('condition_type', req.query.condition_type);
      if (req.query.is_active !== undefined) query.where('is_active', Number(req.query.is_active));
      query.orderBy('created_at', 'desc');

      const rules = await query;
      res.success(rules);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/policies
 * Create a new policy rule with validation.
 * Requirements: 15.2
 */
router.post(
  '/',
  validate({
    body: {
      merchant_id: { required: true, type: 'number' },
      name: { required: true, type: 'string' },
      condition_type: { required: true, type: 'string', oneOf: VALID_CONDITION_TYPES },
      condition_value: { required: true, type: 'string' },
      action_type: { required: true, type: 'string' },
      action_value: { required: true, type: 'string' },
    },
  }),
  async (req, res, next) => {
    try {
      const { merchant_id, name, condition_type, condition_value, action_type, action_value } = req.body;

      // Check for conflicts: no two active rules with the same condition_type for the same merchant
      const conflict = await db('policy_rules')
        .where({ merchant_id, condition_type, is_active: 1 })
        .first();

      if (conflict) {
        throw new AppError(
          409,
          'POLICY_CONFLICT',
          `An active policy rule with condition_type '${condition_type}' already exists for this merchant`,
          { conflicting_rule_id: conflict.id, conflicting_rule_name: conflict.name }
        );
      }

      const now = new Date().toISOString();
      const [id] = await db('policy_rules').insert({
        merchant_id,
        name,
        condition_type,
        condition_value,
        action_type,
        action_value,
        is_active: 1,
        created_at: now,
        updated_at: now,
      });

      const rule = await db('policy_rules').where({ id }).first();
      res.success(rule, 201);
    } catch (err) {
      if (err instanceof AppError) return next(err);
      next(err);
    }
  }
);

/**
 * PUT /api/v1/policies/:id
 * Update an existing policy rule.
 * Requirements: 15.3
 */
router.put(
  '/:id',
  validate({
    params: { id: { required: true, type: 'number' } },
    body: {
      name: { required: false, type: 'string' },
      condition_type: { required: false, type: 'string', oneOf: VALID_CONDITION_TYPES },
      condition_value: { required: false, type: 'string' },
      action_type: { required: false, type: 'string' },
      action_value: { required: false, type: 'string' },
      is_active: { required: false, type: 'number' },
    },
  }),
  async (req, res, next) => {
    try {
      const ruleId = Number(req.params.id);
      const existing = await db('policy_rules').where({ id: ruleId }).first();
      if (!existing) {
        throw new AppError(404, 'POLICY_NOT_FOUND', `Policy rule with ID ${ruleId} not found`);
      }

      const updates = {};
      const allowedFields = ['name', 'condition_type', 'condition_value', 'action_type', 'action_value', 'is_active'];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      if (Object.keys(updates).length === 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'No valid fields provided for update');
      }

      // Check for conflicts if condition_type is being changed or rule is being activated
      const newConditionType = updates.condition_type || existing.condition_type;
      const newIsActive = updates.is_active !== undefined ? updates.is_active : existing.is_active;

      if (newIsActive === 1) {
        const conflict = await db('policy_rules')
          .where({ merchant_id: existing.merchant_id, condition_type: newConditionType, is_active: 1 })
          .whereNot({ id: ruleId })
          .first();

        if (conflict) {
          throw new AppError(
            409,
            'POLICY_CONFLICT',
            `An active policy rule with condition_type '${newConditionType}' already exists for this merchant`,
            { conflicting_rule_id: conflict.id, conflicting_rule_name: conflict.name }
          );
        }
      }

      updates.updated_at = new Date().toISOString();
      await db('policy_rules').where({ id: ruleId }).update(updates);

      const updated = await db('policy_rules').where({ id: ruleId }).first();
      res.success(updated);
    } catch (err) {
      if (err instanceof AppError) return next(err);
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/policies/:id
 * Delete a policy rule.
 * Requirements: 15.1
 */
router.delete(
  '/:id',
  validate({
    params: { id: { required: true, type: 'number' } },
  }),
  async (req, res, next) => {
    try {
      const ruleId = Number(req.params.id);
      const existing = await db('policy_rules').where({ id: ruleId }).first();
      if (!existing) {
        throw new AppError(404, 'POLICY_NOT_FOUND', `Policy rule with ID ${ruleId} not found`);
      }

      await db('policy_rules').where({ id: ruleId }).del();
      res.success({ deleted: true, id: ruleId });
    } catch (err) {
      if (err instanceof AppError) return next(err);
      next(err);
    }
  }
);

export default router;
