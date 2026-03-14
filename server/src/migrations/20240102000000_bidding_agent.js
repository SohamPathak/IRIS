/**
 * Bidding Agent schema — 7 new tables for commodity management,
 * bidding, negotiation, transaction records, credit lines, and dispute artifacts.
 */
export async function up(knex) {
  // 1. commodities
  await knex.schema.createTable('commodities', (t) => {
    t.increments('id').primary();
    t.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('description');
    t.text('unit').notNullable(); // meters, rolls, pieces, kg, yards
    t.real('available_quantity').notNullable().defaultTo(0);
    t.real('min_price_per_unit').notNullable();
    t.real('max_price_per_unit').notNullable();
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
    t.text('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // 2. bids
  await knex.schema.createTable('bids', (t) => {
    t.increments('id').primary();
    t.integer('buyer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    t.integer('commodity_id').notNullable().references('id').inTable('commodities').onDelete('CASCADE');
    t.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.real('requested_quantity').notNullable();
    t.real('offered_price_per_unit').notNullable();
    t.text('status').notNullable().defaultTo('submitted'); // submitted, negotiating, approved, rejected, expired
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
    t.text('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // 3. negotiation_sessions
  await knex.schema.createTable('negotiation_sessions', (t) => {
    t.increments('id').primary();
    t.integer('bid_id').notNullable().references('id').inTable('bids').onDelete('CASCADE');
    t.integer('buyer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    t.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.text('status').notNullable().defaultTo('active'); // active, completed, expired
    t.text('system_prompt');
    t.text('context_json');
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
    t.text('last_activity_at').notNullable().defaultTo(knex.fn.now());
  });

  // 4. negotiation_messages
  await knex.schema.createTable('negotiation_messages', (t) => {
    t.increments('id').primary();
    t.integer('session_id').notNullable().references('id').inTable('negotiation_sessions').onDelete('CASCADE');
    t.text('sender').notNullable(); // buyer, agent
    t.text('content').notNullable();
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // 5. transaction_records
  await knex.schema.createTable('transaction_records', (t) => {
    t.increments('id').primary();
    t.integer('bid_id').references('id').inTable('bids').onDelete('SET NULL');
    t.integer('buyer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    t.integer('commodity_id').notNullable().references('id').inTable('commodities').onDelete('CASCADE');
    t.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.real('quantity').notNullable();
    t.real('agreed_price_per_unit').notNullable();
    t.real('total_amount').notNullable();
    t.text('payment_method').notNullable(); // payment_link, credit_line
    t.text('payment_status').notNullable().defaultTo('pending'); // pending, paid, partial, overdue
    t.text('payment_link');
    t.text('shipping_date');
    t.text('due_date');
    t.text('completed_at');
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // 6. credit_lines
  await knex.schema.createTable('credit_lines', (t) => {
    t.increments('id').primary();
    t.integer('transaction_record_id').notNullable().references('id').inTable('transaction_records').onDelete('CASCADE');
    t.integer('buyer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    t.integer('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.real('amount').notNullable();
    t.text('due_date').notNullable();
    t.text('status').notNullable().defaultTo('active'); // active, paid, overdue, defaulted
    t.text('payment_link');
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
    t.text('paid_at');
  });

  // 7. dispute_artifacts
  await knex.schema.createTable('dispute_artifacts', (t) => {
    t.increments('id').primary();
    t.integer('dispute_id').notNullable().references('id').inTable('disputes').onDelete('CASCADE');
    t.text('artifact_type').notNullable(); // photo, document, receipt, other
    t.text('description');
    t.text('file_path');
    t.text('review_status').notNullable().defaultTo('pending'); // pending, reviewed, manual_override
    t.text('review_assessment');
    t.text('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  const tables = [
    'dispute_artifacts', 'credit_lines', 'transaction_records',
    'negotiation_messages', 'negotiation_sessions', 'bids', 'commodities',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
