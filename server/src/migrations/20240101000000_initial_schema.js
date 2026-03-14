/**
 * Initial schema for Project Iris — all 15 tables.
 */
export async function up(knex) {
  // 1. merchants
  await knex.schema.createTable('merchants', (t) => {
    t.increments('id').primary();
    t.text('name').notNullable();
    t.text('email').notNullable();
    t.text('business_type').notNullable();
    t.text('api_key').notNullable();
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // 2. customers
  await knex.schema.createTable('customers', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('email').notNullable();
    t.text('phone').notNullable();
    t.real('risk_score').notNullable().defaultTo(50);
    t.text('risk_category').notNullable().defaultTo('medium');
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // 3. invoices
  await knex.schema.createTable('invoices', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.integer('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    t.real('amount').notNullable();
    t.real('balance_due').notNullable();
    t.text('status').notNullable().defaultTo('pending'); // pending, overdue, paid, partial
    t.text('due_date').notNullable();
    t.text('paid_at');
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // 4. invoice_line_items
  await knex.schema.createTable('invoice_line_items', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id').notNullable().references('id').inTable('invoices').onDelete('CASCADE');
    t.text('description').notNullable();
    t.integer('quantity').notNullable().defaultTo(1);
    t.real('unit_price').notNullable();
    t.real('total').notNullable();
  });

  // 5. invoice_status_history
  await knex.schema.createTable('invoice_status_history', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id').notNullable().references('id').inTable('invoices').onDelete('CASCADE');
    t.text('old_status');
    t.text('new_status').notNullable();
    t.text('changed_at').notNullable().defaultTo(knex.fn.now());
    t.text('reason');
  });

  // 6. reminders
  await knex.schema.createTable('reminders', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id').notNullable().references('id').inTable('invoices').onDelete('CASCADE');
    t.integer('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    t.text('escalation_level').notNullable(); // friendly, firm, final
    t.text('channel').notNullable(); // email, sms, whatsapp
    t.text('payment_link');
    t.text('status').notNullable().defaultTo('sent');
    t.text('sent_at').notNullable().defaultTo(knex.fn.now());
    t.text('responded_at');
  });

  // 7. customer_response_profiles
  await knex.schema.createTable('customer_response_profiles', (t) => {
    t.increments('id').primary();
    t.integer('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    t.text('escalation_level').notNullable();
    t.text('channel').notNullable();
    t.integer('attempts').notNullable().defaultTo(0);
    t.integer('successes').notNullable().defaultTo(0);
    t.real('success_rate').notNullable().defaultTo(0);
  });

  // 8. payment_plans
  await knex.schema.createTable('payment_plans', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id').notNullable().references('id').inTable('invoices').onDelete('CASCADE');
    t.integer('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    t.integer('num_installments').notNullable();
    t.real('installment_amount').notNullable();
    t.text('status').notNullable().defaultTo('active'); // active, completed, defaulted
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // 9. installments
  await knex.schema.createTable('installments', (t) => {
    t.increments('id').primary();
    t.integer('payment_plan_id').notNullable().references('id').inTable('payment_plans').onDelete('CASCADE');
    t.integer('installment_number').notNullable();
    t.real('amount').notNullable();
    t.text('due_date').notNullable();
    t.text('status').notNullable().defaultTo('pending'); // pending, paid, missed
    t.text('payment_link');
    t.text('paid_at');
  });

  // 10. disputes
  await knex.schema.createTable('disputes', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.integer('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    t.integer('invoice_id').notNullable().references('id').inTable('invoices').onDelete('CASCADE');
    t.text('claim_details').notNullable();
    t.text('status').notNullable().defaultTo('open'); // open, verifying, resolved, reopened
    t.text('verification_status');
    t.text('resolution_type'); // full_refund, partial_refund, replacement, rejection
    t.text('resolution_details');
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
    t.text('resolved_at');
  });

  // 11. transactions
  await knex.schema.createTable('transactions', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.text('type').notNullable(); // incoming, outgoing
    t.real('amount').notNullable();
    t.text('reference_type'); // invoice, dispute, installment
    t.integer('reference_id');
    t.text('pine_labs_ref');
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // 12. threats
  await knex.schema.createTable('threats', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.text('threat_type').notNullable();
    t.text('severity').notNullable(); // low, medium, high, critical
    t.text('description').notNullable();
    t.text('recommended_actions').notNullable();
    t.integer('related_customer_id').references('id').inTable('customers').onDelete('SET NULL');
    t.text('status').notNullable().defaultTo('active'); // active, acknowledged, resolved
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // 13. action_logs
  await knex.schema.createTable('action_logs', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.text('agent_type').notNullable(); // collection, deduction
    t.text('decision_type').notNullable();
    t.text('inputs');
    t.text('policy_rules_applied');
    t.text('outcome').notNullable();
    t.text('reasoning').notNullable();
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // 14. policy_rules
  await knex.schema.createTable('policy_rules', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('condition_type').notNullable(); // refund_threshold, emi_eligibility, reminder_timing, risk_threshold
    t.text('condition_value').notNullable();
    t.text('action_type').notNullable();
    t.text('action_value').notNullable();
    t.integer('is_active').notNullable().defaultTo(1);
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
    t.text('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // 15. cash_flow_predictions
  await knex.schema.createTable('cash_flow_predictions', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.text('prediction_date').notNullable();
    t.real('predicted_incoming').notNullable();
    t.real('predicted_outgoing').notNullable();
    t.real('predicted_net').notNullable();
    t.text('generated_at').notNullable().defaultTo(knex.fn.now());
  });

  // 16. webhook_subscriptions
  await knex.schema.createTable('webhook_subscriptions', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.text('event_type').notNullable();
    t.text('callback_url').notNullable();
    t.text('api_key');
    t.integer('is_active').notNullable().defaultTo(1);
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  const tables = [
    'webhook_subscriptions', 'cash_flow_predictions', 'policy_rules',
    'action_logs', 'threats', 'transactions', 'disputes', 'installments',
    'payment_plans', 'customer_response_profiles', 'reminders',
    'invoice_status_history', 'invoice_line_items', 'invoices',
    'customers', 'merchants',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
