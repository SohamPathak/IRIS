/**
 * Seed data script for Project Iris.
 * Generates realistic Indian business data:
 *   5 merchants, 50 customers, 200 invoices, 30 disputes, 500 transactions
 *
 * Idempotent — safe to re-run (clears existing data first).
 */
import knex from 'knex';
import knexConfig from '../knexfile.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = knex(knexConfig);

// ── Helpers ──────────────────────────────────────────────────────────────────

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function pick(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function isoTimestamp(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(randomInt(8, 20), randomInt(0, 59), randomInt(0, 59));
  return d.toISOString();
}

// ── Merchant data ────────────────────────────────────────────────────────────

const MERCHANTS = [
  { name: 'Priya Silk Sarees', email: 'priya@priyasilks.in', business_type: 'D2C Brand', api_key: 'key-priya-silk-001' },
  { name: 'QuickFix Home Services', email: 'ops@quickfixhome.in', business_type: 'Service Business', api_key: 'key-quickfix-002' },
  { name: 'Arjun Mehta Design Studio', email: 'arjun@mehtadesign.in', business_type: 'Freelancer', api_key: 'key-arjun-003' },
  { name: 'Bharat Precision Parts', email: 'sales@bharatprecision.in', business_type: 'Manufacturer', api_key: 'key-bharat-004' },
  { name: 'Desi Basket Retail', email: 'hello@desibasket.in', business_type: 'Retailer', api_key: 'key-desi-005' },
];

// ── Customer names (Indian) ──────────────────────────────────────────────────

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan',
  'Krishna', 'Ishaan', 'Ananya', 'Diya', 'Myra', 'Sara', 'Aadhya', 'Isha',
  'Kavya', 'Riya', 'Neha', 'Pooja', 'Rahul', 'Amit', 'Suresh', 'Deepak',
  'Vikram', 'Pradeep', 'Sunita', 'Meena', 'Lakshmi', 'Geeta', 'Rajesh',
  'Manoj', 'Kiran', 'Nisha', 'Divya', 'Sneha', 'Rohan', 'Nikhil', 'Gaurav',
  'Pankaj', 'Swati', 'Preeti', 'Anjali', 'Suman', 'Rekha', 'Harish',
  'Mohan', 'Ramesh', 'Sunil', 'Arun',
];

const LAST_NAMES = [
  'Sharma', 'Verma', 'Gupta', 'Singh', 'Kumar', 'Patel', 'Reddy', 'Nair',
  'Joshi', 'Mehta', 'Iyer', 'Rao', 'Das', 'Bhat', 'Pillai', 'Menon',
  'Chauhan', 'Tiwari', 'Pandey', 'Mishra', 'Agarwal', 'Bansal', 'Kapoor',
  'Malhotra', 'Saxena',
];

const PRODUCT_ITEMS = [
  'Banarasi Silk Saree', 'Cotton Kurta Set', 'Handloom Dupatta', 'Plumbing Repair',
  'AC Servicing', 'Electrical Wiring', 'Logo Design Package', 'Brand Identity Kit',
  'Website Mockup', 'CNC Machined Part', 'Steel Bearing Assembly', 'Precision Gear Set',
  'Organic Spice Box', 'Dry Fruit Hamper', 'Artisan Tea Collection', 'Embroidered Cushion Cover',
  'Ceramic Dinner Set', 'Brass Diya Set', 'Jute Tote Bag', 'Wooden Serving Board',
];

// ── Seed functions ───────────────────────────────────────────────────────────

async function seedMerchants() {
  const rows = MERCHANTS.map((m) => ({
    ...m,
    created_at: isoTimestamp(-180),
  }));
  await db('merchants').insert(rows);
  return db('merchants').select('*');
}

async function seedCustomers(merchants) {
  const rows = [];
  let nameIdx = 0;
  for (const merchant of merchants) {
    for (let i = 0; i < 10; i++) {
      const first = FIRST_NAMES[nameIdx % FIRST_NAMES.length];
      const last = LAST_NAMES[nameIdx % LAST_NAMES.length];
      // Vary risk profiles: 2 high-risk, 3 medium, 5 low per merchant
      let riskScore, riskCategory;
      if (i < 2) {
        riskScore = randomFloat(67, 95);
        riskCategory = 'high';
      } else if (i < 5) {
        riskScore = randomFloat(34, 66);
        riskCategory = 'medium';
      } else {
        riskScore = randomFloat(5, 33);
        riskCategory = 'low';
      }
      rows.push({
        merchant_id: merchant.id,
        name: `${first} ${last}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}@email.com`,
        phone: `+91${randomInt(7000000000, 9999999999)}`,
        risk_score: riskScore,
        risk_category: riskCategory,
        created_at: isoTimestamp(-randomInt(30, 180)),
      });
      nameIdx++;
    }
  }
  await db('customers').insert(rows);
  return db('customers').select('*');
}

async function seedInvoices(merchants, customers) {
  const invoiceRows = [];
  const lineItemRows = [];
  const historyRows = [];
  let invoiceId = 1;

  for (const merchant of merchants) {
    const merchantCustomers = customers.filter((c) => c.merchant_id === merchant.id);
    // ~40 invoices per merchant = 200 total
    for (let i = 0; i < 40; i++) {
      const customer = pick(merchantCustomers);
      const amount = randomFloat(500, 500000);
      const createdDaysAgo = randomInt(1, 180);
      const dueDaysAgo = createdDaysAgo - randomInt(15, 45);
      const createdAt = isoTimestamp(-createdDaysAgo);
      const dueDate = daysAgo(dueDaysAgo);

      // Status distribution: 40% paid, 30% pending, 20% overdue, 10% partial
      let status, balanceDue, paidAt;
      const roll = Math.random();
      if (roll < 0.4) {
        status = 'paid';
        balanceDue = 0;
        paidAt = isoTimestamp(-randomInt(0, dueDaysAgo > 0 ? dueDaysAgo : 1));
      } else if (roll < 0.7) {
        status = 'pending';
        balanceDue = amount;
        paidAt = null;
      } else if (roll < 0.9) {
        status = 'overdue';
        balanceDue = amount;
        paidAt = null;
      } else {
        status = 'partial';
        balanceDue = randomFloat(500, amount - 100);
        paidAt = null;
      }

      invoiceRows.push({
        merchant_id: merchant.id,
        customer_id: customer.id,
        amount,
        balance_due: balanceDue,
        status,
        due_date: dueDate,
        paid_at: paidAt,
        created_at: createdAt,
      });

      // Line items (1-3 per invoice)
      const numItems = randomInt(1, 3);
      let lineTotal = 0;
      for (let j = 0; j < numItems; j++) {
        const qty = randomInt(1, 5);
        const unitPrice = j === numItems - 1
          ? Math.round((amount - lineTotal) / qty * 100) / 100
          : randomFloat(200, amount / numItems);
        const total = Math.round(qty * unitPrice * 100) / 100;
        lineTotal += total;
        lineItemRows.push({
          invoice_id: invoiceId,
          description: pick(PRODUCT_ITEMS),
          quantity: qty,
          unit_price: unitPrice,
          total,
        });
      }

      // Status history
      historyRows.push({
        invoice_id: invoiceId,
        old_status: null,
        new_status: 'pending',
        changed_at: createdAt,
        reason: 'Invoice created',
      });
      if (status !== 'pending') {
        historyRows.push({
          invoice_id: invoiceId,
          old_status: 'pending',
          new_status: status,
          changed_at: status === 'paid' ? paidAt : isoTimestamp(-randomInt(0, dueDaysAgo > 0 ? dueDaysAgo : 1)),
          reason: status === 'paid' ? 'Full payment received' : status === 'overdue' ? 'Due date passed' : 'Partial payment received',
        });
      }

      invoiceId++;
    }
  }

  // Insert in batches to avoid SQLite limits
  for (let i = 0; i < invoiceRows.length; i += 50) {
    await db('invoices').insert(invoiceRows.slice(i, i + 50));
  }
  for (let i = 0; i < lineItemRows.length; i += 50) {
    await db('invoice_line_items').insert(lineItemRows.slice(i, i + 50));
  }
  for (let i = 0; i < historyRows.length; i += 50) {
    await db('invoice_status_history').insert(historyRows.slice(i, i + 50));
  }

  return db('invoices').select('*');
}

async function seedDisputes(merchants, customers, invoices) {
  const rows = [];
  const statuses = ['open', 'verifying', 'resolved', 'resolved', 'resolved', 'reopened'];
  const resolutionTypes = ['full_refund', 'partial_refund', 'replacement', 'rejection'];
  const claimReasons = [
    'Product received was damaged during shipping',
    'Wrong item delivered, ordered blue but received red',
    'Service was not completed as agreed',
    'Quality does not match the product description',
    'Item missing from the order',
    'Duplicate charge on my account',
    'Delivery was delayed by more than 2 weeks',
    'Product stopped working within a week',
    'Size does not match the specifications listed',
    'Received expired goods',
  ];

  for (const merchant of merchants) {
    const merchantInvoices = invoices.filter((inv) => inv.merchant_id === merchant.id);
    // 6 disputes per merchant = 30 total
    for (let i = 0; i < 6; i++) {
      const invoice = pick(merchantInvoices);
      const customer = customers.find((c) => c.id === invoice.customer_id);
      const status = pick(statuses);
      const isResolved = status === 'resolved';
      const createdDaysAgo = randomInt(1, 120);

      rows.push({
        merchant_id: merchant.id,
        customer_id: customer.id,
        invoice_id: invoice.id,
        claim_details: pick(claimReasons),
        status,
        verification_status: isResolved ? 'verified' : status === 'verifying' ? 'in_progress' : status === 'open' ? 'pending' : 'verified',
        resolution_type: isResolved ? pick(resolutionTypes) : null,
        resolution_details: isResolved ? 'Resolved per merchant policy rules' : null,
        created_at: isoTimestamp(-createdDaysAgo),
        resolved_at: isResolved ? isoTimestamp(-randomInt(0, createdDaysAgo)) : null,
      });
    }
  }

  await db('disputes').insert(rows);
  return db('disputes').select('*');
}

async function seedTransactions(merchants, invoices) {
  const rows = [];

  for (const merchant of merchants) {
    // 100 transactions per merchant = 500 total
    for (let i = 0; i < 100; i++) {
      const isIncoming = Math.random() < 0.75; // 75% incoming, 25% outgoing (refunds)
      const amount = randomFloat(500, 500000);
      const createdDaysAgo = randomInt(0, 180);
      const merchantInvoices = invoices.filter((inv) => inv.merchant_id === merchant.id);
      const refInvoice = pick(merchantInvoices);

      rows.push({
        merchant_id: merchant.id,
        type: isIncoming ? 'incoming' : 'outgoing',
        amount,
        reference_type: isIncoming ? 'invoice' : 'dispute',
        reference_id: refInvoice.id,
        pine_labs_ref: `PL-${isIncoming ? 'PAY' : 'REF'}-${Date.now()}-${randomInt(1000, 9999)}`,
        created_at: isoTimestamp(-createdDaysAgo),
      });
    }
  }

  // Insert in batches
  for (let i = 0; i < rows.length; i += 50) {
    await db('transactions').insert(rows.slice(i, i + 50));
  }
  return db('transactions').select('*');
}

async function seedReminders(invoices, customers) {
  const rows = [];
  const overdueInvoices = invoices.filter((inv) => inv.status === 'overdue');
  const channels = ['email', 'sms', 'whatsapp'];

  for (const invoice of overdueInvoices.slice(0, 30)) {
    const customer = customers.find((c) => c.id === invoice.customer_id);
    // Create escalation chain
    const levels = ['friendly'];
    if (Math.random() < 0.6) levels.push('firm');
    if (levels.length === 2 && Math.random() < 0.4) levels.push('final');

    for (let i = 0; i < levels.length; i++) {
      rows.push({
        invoice_id: invoice.id,
        customer_id: customer.id,
        escalation_level: levels[i],
        channel: pick(channels),
        payment_link: `https://pinelabs.mock/pay/${invoice.id}?amount=${invoice.balance_due}`,
        status: i === levels.length - 1 ? 'sent' : 'no_response',
        sent_at: isoTimestamp(-randomInt(1, 60)),
        responded_at: null,
      });
    }
  }

  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 50) {
      await db('reminders').insert(rows.slice(i, i + 50));
    }
  }
}

async function seedResponseProfiles(customers) {
  const rows = [];
  const levels = ['friendly', 'firm', 'final'];
  const channels = ['email', 'sms', 'whatsapp'];

  for (const customer of customers) {
    // 1-3 profiles per customer
    const numProfiles = randomInt(1, 3);
    const usedCombos = new Set();
    for (let i = 0; i < numProfiles; i++) {
      const level = pick(levels);
      const channel = pick(channels);
      const key = `${level}-${channel}`;
      if (usedCombos.has(key)) continue;
      usedCombos.add(key);

      const attempts = randomInt(1, 10);
      const successes = randomInt(0, attempts);
      rows.push({
        customer_id: customer.id,
        escalation_level: level,
        channel,
        attempts,
        successes,
        success_rate: Math.round((successes / attempts) * 100) / 100,
      });
    }
  }

  for (let i = 0; i < rows.length; i += 50) {
    await db('customer_response_profiles').insert(rows.slice(i, i + 50));
  }
}

async function seedPaymentPlans(invoices, customers) {
  const rows = [];
  const installmentRows = [];
  let planId = 1;

  // Create payment plans for some overdue/partial invoices
  const eligibleInvoices = invoices.filter((inv) => inv.status === 'overdue' || inv.status === 'partial').slice(0, 10);

  for (const invoice of eligibleInvoices) {
    const customer = customers.find((c) => c.id === invoice.customer_id);
    const numInstallments = pick([3, 6, 9, 12]);
    const installmentAmount = Math.round((invoice.balance_due / numInstallments) * 100) / 100;
    const planStatus = pick(['active', 'active', 'active', 'completed', 'defaulted']);

    rows.push({
      invoice_id: invoice.id,
      customer_id: customer.id,
      num_installments: numInstallments,
      installment_amount: installmentAmount,
      status: planStatus,
      created_at: isoTimestamp(-randomInt(10, 90)),
    });

    for (let i = 1; i <= numInstallments; i++) {
      const dueDate = daysFromNow(-90 + i * 30);
      let instStatus = 'pending';
      let paidAt = null;
      if (planStatus === 'completed') {
        instStatus = 'paid';
        paidAt = isoTimestamp(-randomInt(0, 60));
      } else if (planStatus === 'defaulted' && i <= 2) {
        instStatus = 'paid';
        paidAt = isoTimestamp(-randomInt(30, 60));
      } else if (planStatus === 'defaulted' && i === 3) {
        instStatus = 'missed';
      } else if (planStatus === 'active' && i <= Math.floor(numInstallments / 3)) {
        instStatus = 'paid';
        paidAt = isoTimestamp(-randomInt(10, 40));
      }

      // Adjust last installment to make sum exact
      const amount = i === numInstallments
        ? Math.round((invoice.balance_due - installmentAmount * (numInstallments - 1)) * 100) / 100
        : installmentAmount;

      installmentRows.push({
        payment_plan_id: planId,
        installment_number: i,
        amount,
        due_date: dueDate,
        status: instStatus,
        payment_link: `https://pinelabs.mock/pay/plan-${planId}-inst-${i}?amount=${amount}`,
        paid_at: paidAt,
      });
    }
    planId++;
  }

  if (rows.length > 0) {
    await db('payment_plans').insert(rows);
    for (let i = 0; i < installmentRows.length; i += 50) {
      await db('installments').insert(installmentRows.slice(i, i + 50));
    }
  }
}

async function seedThreats(merchants, customers) {
  const rows = [];
  const threatTemplates = [
    { threat_type: 'high_refund_ratio', severity: 'high', description: 'Refund-to-collection ratio exceeded 25% in the last 30 days', recommended_actions: 'Review refund policies; investigate top refund sources' },
    { threat_type: 'slow_collections', severity: 'medium', description: 'Average days-to-pay increased to 45 days (threshold: 30)', recommended_actions: 'Send targeted reminders to slow-paying customers; consider early payment discounts' },
    { threat_type: 'potential_fraud', severity: 'critical', description: 'Customer filed 5 refund requests in 7 days — abnormal spike detected', recommended_actions: 'Temporarily hold refunds for this customer; manual review required' },
    { threat_type: 'payment_anomaly', severity: 'low', description: 'Multiple failed payment attempts detected from a single customer', recommended_actions: 'Verify customer payment method; reach out to confirm details' },
    { threat_type: 'cash_flow_risk', severity: 'high', description: 'Predicted negative cash flow within 15 days based on pending invoices and refund trends', recommended_actions: 'Accelerate collection efforts; defer non-essential refunds' },
  ];

  for (const merchant of merchants) {
    const merchantCustomers = customers.filter((c) => c.merchant_id === merchant.id);
    // 2-3 threats per merchant
    const numThreats = randomInt(2, 3);
    const usedTypes = new Set();
    for (let i = 0; i < numThreats; i++) {
      let template = pick(threatTemplates);
      while (usedTypes.has(template.threat_type)) template = pick(threatTemplates);
      usedTypes.add(template.threat_type);

      const relatedCustomer = template.threat_type === 'potential_fraud' ? pick(merchantCustomers) : null;
      rows.push({
        merchant_id: merchant.id,
        ...template,
        related_customer_id: relatedCustomer ? relatedCustomer.id : null,
        status: pick(['active', 'active', 'acknowledged']),
        created_at: isoTimestamp(-randomInt(0, 30)),
      });
    }
  }

  await db('threats').insert(rows);
}

async function seedActionLogs(merchants) {
  const rows = [];
  const actionTemplates = [
    { agent_type: 'collection', decision_type: 'send_reminder', outcome: 'Reminder sent successfully', reasoning: 'Invoice overdue by 3 days. Friendly reminder selected based on customer profile.' },
    { agent_type: 'collection', decision_type: 'escalate_reminder', outcome: 'Escalated to firm reminder', reasoning: 'No response to friendly reminder after 7 days. Escalating per policy.' },
    { agent_type: 'collection', decision_type: 'flag_high_risk', outcome: 'Customer flagged as high-risk', reasoning: 'Customer has 3 overdue invoices totaling ₹1,50,000. Risk score: 78.' },
    { agent_type: 'collection', decision_type: 'offer_payment_plan', outcome: 'EMI plan offered', reasoning: 'Invoice overdue > 30 days. Policy allows EMI offer. 6-month plan generated.' },
    { agent_type: 'deduction', decision_type: 'auto_approve_refund', outcome: 'Refund approved automatically', reasoning: 'Dispute amount ₹450 is below auto-approve threshold of ₹500.' },
    { agent_type: 'deduction', decision_type: 'resolve_dispute', outcome: 'Partial refund issued', reasoning: 'Claim verified. Product partially damaged. 50% refund per policy.' },
    { agent_type: 'deduction', decision_type: 'request_info', outcome: 'Additional info requested', reasoning: 'Claim lacks delivery proof. Requesting photo evidence from customer.' },
    { agent_type: 'collection', decision_type: 'compute_risk_score', outcome: 'Risk score updated', reasoning: 'Payment history analyzed. 4 late payments, avg 42 days to pay. Score: 72 (high).' },
  ];

  for (const merchant of merchants) {
    // ~20 action logs per merchant
    for (let i = 0; i < 20; i++) {
      const template = pick(actionTemplates);
      rows.push({
        merchant_id: merchant.id,
        ...template,
        inputs: JSON.stringify({ merchant_id: merchant.id, timestamp: isoTimestamp(-randomInt(0, 90)) }),
        policy_rules_applied: JSON.stringify(['default_reminder_policy', 'refund_threshold_500']),
        created_at: isoTimestamp(-randomInt(0, 90)),
      });
    }
  }

  for (let i = 0; i < rows.length; i += 50) {
    await db('action_logs').insert(rows.slice(i, i + 50));
  }
}

async function seedPolicyRules(merchants) {
  const rows = [];
  const defaultPolicies = [
    { name: 'Auto-approve small refunds', condition_type: 'refund_threshold', condition_value: '500', action_type: 'auto_approve', action_value: 'refund' },
    { name: 'EMI for 30+ day overdue', condition_type: 'emi_eligibility', condition_value: '30', action_type: 'offer_emi', action_value: '{"max_installments": 12}' },
    { name: 'Reminder after 1 day overdue', condition_type: 'reminder_timing', condition_value: '1', action_type: 'send_reminder', action_value: '{"level": "friendly"}' },
    { name: 'High-risk threshold ₹1,00,000', condition_type: 'risk_threshold', condition_value: '100000', action_type: 'flag_risk', action_value: '{"notify": true}' },
  ];

  for (const merchant of merchants) {
    for (const policy of defaultPolicies) {
      rows.push({
        merchant_id: merchant.id,
        ...policy,
        is_active: 1,
        created_at: isoTimestamp(-180),
        updated_at: isoTimestamp(-180),
      });
    }
  }

  await db('policy_rules').insert(rows);
}

async function seedCashFlowPredictions(merchants) {
  const rows = [];

  for (const merchant of merchants) {
    // 90 days of predictions
    for (let day = 0; day < 90; day++) {
      const incoming = randomFloat(5000, 80000);
      const outgoing = randomFloat(1000, 30000);
      rows.push({
        merchant_id: merchant.id,
        prediction_date: daysFromNow(day),
        predicted_incoming: incoming,
        predicted_outgoing: outgoing,
        predicted_net: Math.round((incoming - outgoing) * 100) / 100,
        generated_at: new Date().toISOString(),
      });
    }
  }

  for (let i = 0; i < rows.length; i += 50) {
    await db('cash_flow_predictions').insert(rows.slice(i, i + 50));
  }
}

// ── Bidding Agent Seed Data ───────────────────────────────────────────────────

const CLOTH_TYPES = [
  { name: 'Cotton Cambric', unit: 'meters', min: 120, max: 200 },
  { name: 'Silk Chiffon', unit: 'meters', min: 450, max: 800 },
  { name: 'Linen Blend', unit: 'meters', min: 250, max: 400 },
  { name: 'Polyester Crepe', unit: 'meters', min: 80, max: 150 },
  { name: 'Rayon Viscose', unit: 'meters', min: 100, max: 180 },
  { name: 'Denim Twill', unit: 'meters', min: 200, max: 350 },
  { name: 'Muslin Cotton', unit: 'meters', min: 90, max: 160 },
  { name: 'Georgette Fabric', unit: 'meters', min: 300, max: 550 },
  { name: 'Velvet Plush', unit: 'meters', min: 500, max: 900 },
  { name: 'Khadi Handloom', unit: 'meters', min: 180, max: 320 },
];

async function seedCommodities(merchants) {
  const rows = [];
  for (const m of merchants) {
    for (const cloth of CLOTH_TYPES) {
      rows.push({
        merchant_id: m.id, name: cloth.name, description: `Premium ${cloth.name.toLowerCase()} fabric`,
        unit: cloth.unit, available_quantity: randomFloat(50, 500),
        min_price_per_unit: cloth.min, max_price_per_unit: cloth.max,
        created_at: isoTimestamp(-randomInt(10, 60)), updated_at: isoTimestamp(-randomInt(0, 10)),
      });
    }
  }
  await db('commodities').insert(rows);
  return db('commodities').select('*');
}

async function seedBids(merchants, customers, commodities) {
  // Weighted distribution: more submitted/negotiating for demo purposes
  const weightedStatuses = [
    'submitted', 'submitted', 'submitted', 'submitted', 'submitted',
    'submitted', 'submitted', 'submitted',
    'negotiating', 'negotiating', 'negotiating', 'negotiating', 'negotiating',
    'negotiating', 'negotiating', 'negotiating', 'negotiating', 'negotiating',
    'approved', 'approved', 'approved', 'approved', 'approved',
    'approved',
    'rejected', 'rejected', 'rejected',
    'expired', 'expired', 'expired',
  ];
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const m = pick(merchants);
    const mCommodities = commodities.filter(c => c.merchant_id === m.id);
    const commodity = pick(mCommodities);
    const buyer = pick(customers.filter(c => c.merchant_id === m.id));
    rows.push({
      buyer_id: buyer.id, commodity_id: commodity.id, merchant_id: m.id,
      requested_quantity: randomFloat(5, 100),
      offered_price_per_unit: randomFloat(commodity.min_price_per_unit * 0.7, commodity.max_price_per_unit),
      status: weightedStatuses[i % weightedStatuses.length],
      created_at: isoTimestamp(-randomInt(0, 30)), updated_at: isoTimestamp(-randomInt(0, 5)),
    });
  }
  await db('bids').insert(rows);
  return db('bids').select('*');
}

async function seedTransactionRecords(merchants, customers, commodities, bids) {
  const approvedBids = bids.filter(b => b.status === 'approved');
  const rows = [];
  // Create 15 transaction records
  const count = Math.min(15, approvedBids.length + 10);
  for (let i = 0; i < count; i++) {
    const m = pick(merchants);
    const mCommodities = commodities.filter(c => c.merchant_id === m.id);
    const commodity = pick(mCommodities);
    const buyer = pick(customers.filter(c => c.merchant_id === m.id));
    const qty = randomFloat(5, 50);
    const price = randomFloat(commodity.min_price_per_unit, commodity.max_price_per_unit);
    const total = Math.round(qty * price * 100) / 100;
    const paymentMethod = pick(['payment_link', 'credit_line']);
    const paymentStatus = pick(['pending', 'paid', 'partial', 'overdue']);
    const createdDaysAgo = randomInt(5, 60);
    rows.push({
      bid_id: approvedBids[i]?.id || null,
      buyer_id: buyer.id, commodity_id: commodity.id, merchant_id: m.id,
      quantity: qty, agreed_price_per_unit: price, total_amount: total,
      payment_method: paymentMethod, payment_status: paymentStatus,
      payment_link: `https://pinelabs.mock/pay/TX-${i}?amount=${total}`,
      shipping_date: daysAgo(createdDaysAgo - 3), due_date: daysAgo(createdDaysAgo - 30),
      completed_at: paymentStatus === 'paid' ? isoTimestamp(-randomInt(1, createdDaysAgo)) : null,
      created_at: isoTimestamp(-createdDaysAgo),
    });
  }
  await db('transaction_records').insert(rows);
  return db('transaction_records').select('*');
}

async function seedCreditLines(transactionRecords, customers) {
  const creditTxns = transactionRecords.filter(t => t.payment_method === 'credit_line').slice(0, 5);
  const rows = [];
  for (const tx of creditTxns) {
    const status = pick(['active', 'paid', 'overdue']);
    rows.push({
      transaction_record_id: tx.id, buyer_id: tx.buyer_id, merchant_id: tx.merchant_id,
      amount: tx.total_amount, due_date: tx.due_date || daysFromNow(randomInt(-10, 30)),
      status, payment_link: `https://pinelabs.mock/pay/CL-${tx.id}?amount=${tx.total_amount}`,
      created_at: tx.created_at, paid_at: status === 'paid' ? isoTimestamp(-randomInt(0, 10)) : null,
    });
  }
  if (rows.length > 0) await db('credit_lines').insert(rows);
  return db('credit_lines').select('*');
}

async function seedNegotiationSessions(bids) {
  const negotiatingBids = bids.filter(b => b.status === 'negotiating' || b.status === 'approved').slice(0, 8);

  const conversationTemplates = [
    (commodity, bid) => [
      { sender: 'buyer', content: `Hi, I'd like to buy ${bid.requested_quantity} ${commodity?.unit || 'units'} of ${commodity?.name || 'your product'} at ₹${bid.offered_price_per_unit} per ${commodity?.unit || 'unit'}.` },
      { sender: 'agent', content: `Thank you for your interest in ${commodity?.name || 'our product'}! I appreciate your offer of ₹${bid.offered_price_per_unit} per ${commodity?.unit || 'unit'}.\n\nOur ${commodity?.name} is premium quality — sourced directly from our mills. Given current market rates, I can offer you ₹${commodity?.min_price_per_unit || 200} per ${commodity?.unit || 'unit'}.\n\n📊 That brings your order total to ₹${Math.round((commodity?.min_price_per_unit || 200) * bid.requested_quantity)} for ${bid.requested_quantity} ${commodity?.unit || 'units'}.\n\nWould this work for you?` },
      { sender: 'buyer', content: `That's a bit high for me. Can you do ₹${Math.round(((bid.offered_price_per_unit + (commodity?.min_price_per_unit || 200)) / 2))} per ${commodity?.unit || 'unit'}? I'm a regular buyer and plan to order monthly.` },
      { sender: 'agent', content: `I appreciate you coming back with a revised offer! Considering the volume of ${bid.requested_quantity} ${commodity?.unit || 'units'} and your commitment to regular orders, let me check what I can do...\n\n🏷️ I can bring it down to ₹${Math.round((commodity?.min_price_per_unit || 200) * 0.95)} per ${commodity?.unit || 'unit'}. That's a fair price for this quality.\n\nShall we close at this price?` },
    ],
    (commodity, bid) => [
      { sender: 'buyer', content: `Looking for ${bid.requested_quantity} ${commodity?.unit || 'units'} of ${commodity?.name || 'fabric'}. My budget is ₹${bid.offered_price_per_unit} per ${commodity?.unit || 'unit'}. Can you match this?` },
      { sender: 'agent', content: `Welcome! I see you're interested in our ${commodity?.name}.\n\nYour offer of ₹${bid.offered_price_per_unit} is below our minimum of ₹${commodity?.min_price_per_unit || 200}. However, I understand you're looking for a competitive price.\n\n🏷️ I could start a conversation at ₹${Math.round((commodity?.min_price_per_unit || 200) * 0.98)} per ${commodity?.unit || 'unit'} if you're interested.\n\nWould you like to revise your offer?` },
      { sender: 'buyer', content: `How about ₹${Math.round((commodity?.min_price_per_unit || 200) * 0.92)}? That's the best I can do.` },
    ],
    (commodity, bid) => [
      { sender: 'buyer', content: `I need ${bid.requested_quantity} ${commodity?.unit || 'units'} of ${commodity?.name || 'material'} urgently. Offering ₹${bid.offered_price_per_unit} per ${commodity?.unit || 'unit'}.` },
      { sender: 'agent', content: `Excellent! I'm happy to confirm your order of ${bid.requested_quantity} ${commodity?.unit || 'units'} of ${commodity?.name} at ₹${bid.offered_price_per_unit} per ${commodity?.unit || 'unit'}.\n\n📦 Order Total: ₹${Math.round(bid.offered_price_per_unit * bid.requested_quantity).toLocaleString('en-IN')}\n📅 Estimated Shipping: 7 business days\n\n💳 I'll generate a Pine Labs payment link for you — valid for 3 days.\n\nThank you for your business!` },
    ],
  ];

  for (let idx = 0; idx < negotiatingBids.length; idx++) {
    const bid = negotiatingBids[idx];
    const commodity = await db('commodities').where({ id: bid.commodity_id }).first();
    const context = {
      commodity: { name: commodity?.name || 'Unknown', unit: commodity?.unit || 'units' },
      priceRange: { min: commodity?.min_price_per_unit || 100, max: commodity?.max_price_per_unit || 500 },
      offeredPrice: bid.offered_price_per_unit,
    };
    const [sessionId] = await db('negotiation_sessions').insert({
      bid_id: bid.id, buyer_id: bid.buyer_id, merchant_id: bid.merchant_id,
      status: bid.status === 'approved' ? 'completed' : 'active',
      system_prompt: `Negotiation for ${commodity?.name || 'commodity'}`,
      context_json: JSON.stringify(context),
      created_at: bid.created_at, last_activity_at: isoTimestamp(-randomInt(0, 2)),
    });

    const template = conversationTemplates[idx % conversationTemplates.length];
    const msgs = template(commodity, bid);
    for (const msg of msgs) {
      await db('negotiation_messages').insert({
        session_id: sessionId, sender: msg.sender, content: msg.content,
        created_at: isoTimestamp(-randomInt(0, 5)),
      });
    }
  }
}

async function seedDisputeArtifacts(disputes) {
  const types = ['photo', 'document', 'receipt', 'other'];
  const rows = [];
  for (const d of disputes.slice(0, 10)) {
    const count = randomInt(1, 3);
    for (let i = 0; i < count; i++) {
      rows.push({
        dispute_id: d.id, artifact_type: pick(types),
        description: pick(['Damaged goods photo', 'Invoice copy', 'Delivery receipt', 'Quality report', 'Communication screenshot']),
        file_path: `/uploads/dispute-${d.id}-artifact-${i}.${pick(['jpg', 'pdf', 'png'])}`,
        review_status: pick(['pending', 'reviewed']),
        review_assessment: null,
        created_at: d.created_at,
      });
    }
  }
  if (rows.length > 0) await db('dispute_artifacts').insert(rows);
}

// ── Main seed runner ─────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Seeding Project Iris database...\n');

  // Idempotent: clear all data in reverse dependency order
  const tables = [
    'dispute_artifacts', 'credit_lines', 'transaction_records',
    'negotiation_messages', 'negotiation_sessions', 'bids', 'commodities',
    'webhook_subscriptions', 'cash_flow_predictions', 'policy_rules',
    'action_logs', 'threats', 'transactions', 'installments', 'payment_plans',
    'customer_response_profiles', 'reminders', 'invoice_status_history',
    'invoice_line_items', 'disputes', 'invoices', 'customers', 'merchants',
  ];
  for (const table of tables) {
    await db(table).del();
  }
  // Reset auto-increment counters
  await db.raw("DELETE FROM sqlite_sequence");
  console.log('  ✓ Cleared existing data');

  const merchants = await seedMerchants();
  console.log(`  ✓ ${merchants.length} merchants`);

  const customers = await seedCustomers(merchants);
  console.log(`  ✓ ${customers.length} customers`);

  const invoices = await seedInvoices(merchants, customers);
  console.log(`  ✓ ${invoices.length} invoices`);

  const disputes = await seedDisputes(merchants, customers, invoices);
  console.log(`  ✓ ${disputes.length} disputes`);

  const transactions = await seedTransactions(merchants, invoices);
  console.log(`  ✓ ${transactions.length} transactions`);

  await seedReminders(invoices, customers);
  const reminderCount = await db('reminders').count('* as count').first();
  console.log(`  ✓ ${reminderCount.count} reminders`);

  await seedResponseProfiles(customers);
  const profileCount = await db('customer_response_profiles').count('* as count').first();
  console.log(`  ✓ ${profileCount.count} response profiles`);

  await seedPaymentPlans(invoices, customers);
  const planCount = await db('payment_plans').count('* as count').first();
  const instCount = await db('installments').count('* as count').first();
  console.log(`  ✓ ${planCount.count} payment plans, ${instCount.count} installments`);

  await seedThreats(merchants, customers);
  const threatCount = await db('threats').count('* as count').first();
  console.log(`  ✓ ${threatCount.count} threats`);

  await seedActionLogs(merchants);
  const logCount = await db('action_logs').count('* as count').first();
  console.log(`  ✓ ${logCount.count} action logs`);

  await seedPolicyRules(merchants);
  const policyCount = await db('policy_rules').count('* as count').first();
  console.log(`  ✓ ${policyCount.count} policy rules`);

  await seedCashFlowPredictions(merchants);
  const predCount = await db('cash_flow_predictions').count('* as count').first();
  console.log(`  ✓ ${predCount.count} cash flow predictions`);

  // Bidding Agent seed data
  const commodities = await seedCommodities(merchants);
  console.log(`  ✓ ${commodities.length} commodities`);

  const bids = await seedBids(merchants, customers, commodities);
  console.log(`  ✓ ${bids.length} bids`);

  const txRecords = await seedTransactionRecords(merchants, customers, commodities, bids);
  console.log(`  ✓ ${txRecords.length} transaction records`);

  const creditLines = await seedCreditLines(txRecords, customers);
  console.log(`  ✓ ${creditLines.length} credit lines`);

  await seedNegotiationSessions(bids);
  const sessionCount = await db('negotiation_sessions').count('* as count').first();
  const msgCount = await db('negotiation_messages').count('* as count').first();
  console.log(`  ✓ ${sessionCount.count} negotiation sessions, ${msgCount.count} messages`);

  await seedDisputeArtifacts(disputes);
  const artifactCount = await db('dispute_artifacts').count('* as count').first();
  console.log(`  ✓ ${artifactCount.count} dispute artifacts`);

  console.log('\n✅ Seed complete!');
}

seed()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => db.destroy());
