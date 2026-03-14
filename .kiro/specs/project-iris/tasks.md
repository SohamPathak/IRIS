# Implementation Plan: Project Iris

## Overview

Incremental build of the Project Iris finance recovery platform. Starts with project scaffolding and database, then builds each pillar (Collection, Deduction, Treasury, Overall Cash Flow) with API endpoints, agent logic, and frontend views. Each step produces working, testable code.

## Tasks

- [x] 1. Project scaffolding and database setup
  - [x] 1.1 Initialize monorepo with client (React + Vite + Tailwind CSS) and server (Express.js) packages
    - Create root `package.json` with workspaces
    - Set up `client/` with Vite, React, Tailwind CSS, Recharts
    - Set up `server/` with Express, better-sqlite3, Knex.js, cors, dotenv
    - Create `.env` with `DB_PATH=./data/iris.db`, `PORT=3001`, `API_KEY=iris-dev-key`
    - Add Vitest and fast-check to server dev dependencies
    - _Requirements: 18.1, 18.2_

  - [x] 1.2 Create database schema with Knex.js migrations
    - Create all 15 tables: merchants, customers, invoices, invoice_line_items, invoice_status_history, reminders, customer_response_profiles, payment_plans, installments, disputes, transactions, threats, action_logs, policy_rules, cash_flow_predictions, webhook_subscriptions
    - Apply all data constraints (enums, foreign keys, defaults)
    - Create `server/src/db.js` for database connection setup
    - _Requirements: 1.1, 1.6, 17.1_

  - [x] 1.3 Create seed data script
    - Generate 5 merchants, 50 customers, 200 invoices, 30 disputes, 500 transactions
    - Include realistic Indian business names, INR amounts (₹500–₹5,00,000), dates spanning 6 months
    - Include high-risk customers, overdue invoices, resolved disputes, active payment plans
    - Add default policy rules per merchant
    - Make script idempotent (safe to re-run)
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

  - [ ]* 1.4 Write property test for seed data
    - **Property 42: Seed data amounts in INR range**
    - **Validates: Requirements 17.2**

- [x] 2. Checkpoint — Database and seed data
  - Run migrations, run seed script, verify data counts
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. API foundation and middleware
  - [x] 3.1 Create Express app with middleware stack
    - Set up `server/src/app.js` with Express, CORS, JSON body parser, error handler
    - Create API key authentication middleware (`server/src/middleware/auth.js`)
    - Create error handling middleware with consistent JSON envelope (`{ success, data, error }`)
    - Create request validation middleware
    - _Requirements: 18.1, 18.4_

  - [ ]* 3.2 Write property tests for API foundation
    - **Property 40: API response consistency**
    - **Validates: Requirements 18.1**
    - **Property 41: API key authentication enforcement**
    - **Validates: Requirements 18.4**

- [ ] 4. Pine Labs mock service
  - [x] 4.1 Implement Pine Labs service abstraction and mock
    - Create `server/src/services/pinelabsService.js` with mock implementation
    - `createPaymentLink(invoiceId, amount, expiry)` → returns `https://pinelabs.mock/pay/{invoiceId}?amount={amount}`
    - `sendPaymentLinkViaSMS(phone, link)` and `sendPaymentLinkViaEmail(email, link)` → mock delivery
    - `processRefund(transactionRef, amount)` → returns `MOCK-REFUND-{timestamp}`
    - `validateCallback(payload)` → validates structure
    - Add 200ms simulated delay, retry logic with exponential backoff (3 attempts)
    - _Requirements: 16.1, 16.3, 16.5, 16.6, 16.7, 16.8_

  - [ ]* 4.2 Write property tests for Pine Labs service
    - **Property 37: Payment link format validity**
    - **Validates: Requirements 16.1**
    - **Property 39: Malformed response rejection**
    - **Validates: Requirements 16.7**

- [ ] 5. Risk scoring service
  - [x] 5.1 Implement risk scoring service
    - Create `server/src/services/riskScoringService.js`
    - `computeRiskScore(paymentHistory, overdueFrequency, avgDaysToPay)` → returns 0–100
    - `categorizeRisk(score)` → returns 'low' | 'medium' | 'high'
    - Implement formula: base 50, late payment penalty, days-to-pay penalty, overdue penalty, on-time bonus, clamped [0, 100]
    - _Requirements: 5.4, 12.1_

  - [ ]* 5.2 Write property tests for risk scoring
    - **Property 16: Risk score range and categorization**
    - **Validates: Requirements 5.4, 12.1**
    - **Property 15: Risk score monotonicity with late payments**
    - **Validates: Requirements 5.2**

- [ ] 6. Collection pillar — Invoice management
  - [x] 6.1 Create invoice model and CRUD operations
    - Create `server/src/models/invoice.js` with Knex queries
    - Create, read (with filters by status/date/customer), update balance, update status
    - Record status transitions in invoice_status_history
    - _Requirements: 1.1, 1.4, 1.5, 1.6_

  - [ ]* 6.2 Write property tests for invoice model
    - **Property 1: Invoice creation round-trip**
    - **Validates: Requirements 1.1**
    - **Property 4: Invoice grouping exhaustiveness**
    - **Validates: Requirements 1.4**
    - **Property 5: Partial payment balance invariant**
    - **Validates: Requirements 1.5**
    - **Property 6: Invoice history completeness**
    - **Validates: Requirements 1.6**

  - [x] 6.3 Create invoice API routes
    - Create `server/src/routes/invoices.js`
    - GET `/api/v1/invoices` with status/date filters
    - GET `/api/v1/invoices/:id` with history
    - POST `/api/v1/invoices` to create
    - PATCH `/api/v1/invoices/:id/pay` for full payment
    - PATCH `/api/v1/invoices/:id/partial-pay` for partial payment
    - Wire to app.js
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

- [ ] 7. Collection pillar — Reminders and escalation
  - [x] 7.1 Implement Collection Agent reminder logic
    - Create `server/src/agents/collectionAgent.js`
    - `evaluateOverdueInvoices()` — marks overdue, creates friendly reminders
    - `escalateReminders()` — friendly→firm after 7 days, firm→final after 7 days
    - `sendReminder(invoiceId, level)` — creates reminder with Pine Labs payment link
    - Record all actions in action_log
    - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 7.2 Write property tests for reminder escalation
    - **Property 3: Overdue detection**
    - **Validates: Requirements 1.3**
    - **Property 7: Reminder escalation state machine**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - **Property 8: Reminders always contain payment links**
    - **Validates: Requirements 2.4, 16.2**

  - [x] 7.3 Implement adaptive reminder strategy
    - Add `selectReminderStrategy(customerId)` to Collection Agent
    - Create customer_response_profiles model
    - Track which escalation level and channel led to payment
    - Select highest success rate channel/level for each customer
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 7.4 Write property tests for adaptive strategy
    - **Property 9: Customer response profile update**
    - **Validates: Requirements 3.1, 3.3**
    - **Property 10: Adaptive reminder strategy selection**
    - **Validates: Requirements 3.2**

  - [x] 7.5 Create reminder API routes
    - Create `server/src/routes/reminders.js`
    - GET `/api/v1/reminders` with filters
    - POST `/api/v1/reminders/trigger` to trigger evaluation
    - Wire to app.js
    - _Requirements: 2.1, 2.5_

- [ ] 8. Collection pillar — Payment plans and risk flagging
  - [x] 8.1 Implement payment plan logic in Collection Agent
    - Add `offerPaymentPlan(invoiceId)` — checks policy, creates plan with installments
    - Generate Pine Labs payment links for each installment
    - Calculate installment amounts from balance and EMI terms
    - Handle missed installment reminders
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 8.2 Write property tests for payment plans
    - **Property 11: Payment plan installment sum invariant**
    - **Validates: Requirements 4.4**
    - **Property 12: Payment plan installment links**
    - **Validates: Requirements 4.2**
    - **Property 13: EMI offer threshold**
    - **Validates: Requirements 4.1**

  - [x] 8.3 Implement high-risk flagging in Collection Agent
    - Add `flagHighRiskAccounts()` — flags customers exceeding overdue threshold
    - Add `computeRiskScore(customerId)` — uses risk scoring service
    - Prioritize collection by risk score (descending)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 12.3_

  - [ ]* 8.4 Write property tests for risk flagging
    - **Property 14: High-risk flagging threshold**
    - **Validates: Requirements 5.1**
    - **Property 17: Collection priority ordering**
    - **Validates: Requirements 12.3**

  - [x] 8.5 Create payment plan and customer API routes
    - Create `server/src/routes/paymentPlans.js` and `server/src/routes/customers.js`
    - Payment plan CRUD, installment payment recording
    - Customer list with risk scores, customer detail with risk profile and history
    - Wire to app.js
    - _Requirements: 4.1, 5.3, 12.1, 12.2_

- [x] 9. Checkpoint — Collection pillar complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Deduction pillar — Disputes
  - [x] 10.1 Implement Deduction Agent
    - Create `server/src/agents/deductionAgent.js`
    - `createDispute(disputeData)` — creates dispute record
    - `verifyClaim(disputeId)` — cross-references order data, checks for missing info
    - `resolveDispute(disputeId)` — evaluates against policy rules, selects resolution
    - `processRefund(disputeId, amount)` — processes via Pine Labs, records transaction
    - `reEvaluate(disputeId, newInfo)` — re-evaluates with new information
    - Record all actions and reasoning in action_log
    - _Requirements: 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 10.2 Write property tests for Deduction Agent
    - **Property 18: Dispute creation round-trip**
    - **Validates: Requirements 6.1**
    - **Property 19: Incomplete dispute requests missing info**
    - **Validates: Requirements 6.3**
    - **Property 20: Auto-approve refund threshold**
    - **Validates: Requirements 7.6**
    - **Property 21: Refund transaction recording**
    - **Validates: Requirements 7.2**
    - **Property 22: Action log completeness**
    - **Validates: Requirements 13.1, 13.3**

  - [x] 10.3 Create dispute API routes
    - Create `server/src/routes/disputes.js`
    - GET `/api/v1/disputes` with filters
    - GET `/api/v1/disputes/:id`
    - POST `/api/v1/disputes` to create
    - POST `/api/v1/disputes/:id/resolve` to trigger resolution
    - POST `/api/v1/disputes/:id/re-evaluate`
    - Wire to app.js
    - _Requirements: 6.1, 7.1, 7.4_

- [ ] 11. Treasury pillar — Money movement and predictions
  - [x] 11.1 Implement Treasury Engine
    - Create `server/src/engines/treasuryEngine.js`
    - `recordTransaction(txData)` — records incoming/outgoing with Pine Labs ref
    - `getNetBalance()` — computes sum(incoming) - sum(outgoing)
    - `getCashFlowTimeline(period)` — returns transactions with running balance
    - `generatePredictions()` — generates 90-day forecast from pending invoices and refund trends
    - `checkCashFlowRisk()` — alerts if predicted negative balance within 30 days
    - `getCashFlowSummary(startDate, endDate)` — totals for period
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 11.1_

  - [ ]* 11.2 Write property tests for Treasury Engine
    - **Property 2: Invoice payment status transition**
    - **Validates: Requirements 1.2**
    - **Property 24: Transaction recording for all Pine Labs events**
    - **Validates: Requirements 8.1, 8.2**
    - **Property 25: Net cash flow balance invariant**
    - **Validates: Requirements 8.3**
    - **Property 26: Cash flow summary period filtering**
    - **Validates: Requirements 11.1, 11.2**
    - **Property 27: Dashboard metrics consistency**
    - **Validates: Requirements 11.4**
    - **Property 28: Cash flow prediction negative balance alert**
    - **Validates: Requirements 9.2**

  - [x] 11.3 Implement Threat Detector
    - Create `server/src/engines/threatDetector.js`
    - `checkRefundRatio(merchantId)` — refund/collection ratio in 30-day window
    - `checkSlowCollections(merchantId)` — avg days-to-pay trend
    - `checkCustomerFraud(customerId)` — refund spike detection
    - `checkPaymentAnomalies()` — unusual patterns
    - `evaluateThreats()` — runs all checks
    - Each threat includes severity, description, recommended actions
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 11.4 Write property tests for Threat Detector
    - **Property 29: High refund ratio threat detection**
    - **Validates: Requirements 10.1**
    - **Property 30: Slow collections threat detection**
    - **Validates: Requirements 10.2**
    - **Property 31: Customer fraud spike detection**
    - **Validates: Requirements 10.3**
    - **Property 32: Threat alert completeness**
    - **Validates: Requirements 10.5**

  - [x] 11.5 Create treasury and threat API routes
    - Create `server/src/routes/treasury.js` and `server/src/routes/threats.js`
    - Cash flow summary, transactions timeline, predictions, net balance
    - Threat list, threat evaluation trigger
    - Wire to app.js
    - _Requirements: 8.4, 9.4, 10.5, 11.1, 11.2, 11.4_

- [x] 12. Checkpoint — Treasury and Deduction pillars complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Overall Cash Flow — Dashboard APIs
  - [x] 13.1 Implement Quick Summary Generator
    - Create `server/src/engines/summaryGenerator.js`
    - Template-based generation: collection trend, refund trend, top risk customers, active threats, recommended actions
    - Enforce <200 word limit
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [ ]* 13.2 Write property tests for Quick Summary
    - **Property 33: Quick summary word count invariant**
    - **Validates: Requirements 14.4**
    - **Property 34: Quick summary required sections**
    - **Validates: Requirements 14.2**

  - [x] 13.3 Create dashboard and action log API routes
    - Create `server/src/routes/dashboard.js`
    - GET `/api/v1/dashboard/summary` — quick summary
    - GET `/api/v1/dashboard/metrics` — key metric cards
    - GET `/api/v1/dashboard/action-log` — action log with filters
    - _Requirements: 13.2, 14.1, 11.4_

  - [ ]* 13.4 Write property test for action log ordering
    - **Property 23: Action log chronological ordering**
    - **Validates: Requirements 13.2**

  - [x] 13.5 Implement Policy Editor API
    - Create `server/src/routes/policies.js`
    - CRUD for policy rules with validation (condition + action required, no conflicts)
    - Rule templates endpoint for common scenarios
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [ ]* 13.6 Write property tests for Policy Editor
    - **Property 35: Policy rule validation**
    - **Validates: Requirements 15.2**
    - **Property 36: Policy rule CRUD round-trip**
    - **Validates: Requirements 15.1**

  - [x] 13.7 Implement webhook subscription and Pine Labs callback routes
    - Create `server/src/routes/webhooks.js`
    - POST `/api/v1/webhooks/subscribe`, DELETE `/api/v1/webhooks/:id`
    - POST `/api/v1/webhooks/pine-labs/callback` — handles payment confirmation
    - _Requirements: 16.4, 18.3_

  - [ ]* 13.8 Write property test for payment callback
    - **Property 38: Payment callback invoice update**
    - **Validates: Requirements 16.4**

- [x] 14. Checkpoint — All backend APIs complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Frontend — Layout and Dashboard
  - [x] 15.1 Create app shell and routing
    - Set up React Router with sidebar navigation
    - Create layout component with sidebar: Dashboard, Invoices, Disputes, Treasury, Customers, Action Log, Policy Editor
    - Set up API client service (`client/src/services/api.js`) with base URL and API key header
    - _Requirements: 18.2_

  - [x] 15.2 Build Dashboard page
    - Key metrics cards (total receivables, collected, refunded, net position, collection rate)
    - Net cash flow chart (Recharts line/area chart) with time period filter
    - Quick Summary section
    - Active threats panel with severity badges
    - Risk alerts section for high-risk customers
    - _Requirements: 11.1, 11.2, 11.4, 14.1, 10.5, 5.3_

- [ ] 16. Frontend — Collection views
  - [x] 16.1 Build Invoices page
    - Table with status filters (pending, overdue, paid, partial), search, date range
    - Invoice detail modal with line items and status history timeline
    - Create invoice form
    - Record payment / partial payment actions
    - _Requirements: 1.1, 1.4, 1.6_

  - [x] 16.2 Build Customer Risk page
    - Customer table with risk score badges (low/medium/high)
    - Sort by risk score, filter by category
    - Customer detail view with risk history, payment history, overdue invoices
    - Risk score change highlights with contributing factors
    - _Requirements: 5.3, 12.1, 12.2_

- [ ] 17. Frontend — Deduction and Treasury views
  - [x] 17.1 Build Disputes page
    - Dispute list with status filters
    - Create dispute form (customer-facing)
    - Dispute detail with verification status, resolution, action log
    - Re-evaluate action button
    - _Requirements: 6.1, 7.1, 7.4_

  - [x] 17.2 Build Treasury page
    - Money movement timeline (transaction list with running balance)
    - Cash flow prediction chart (90-day forecast, incoming vs outgoing)
    - Cash flow risk alerts
    - _Requirements: 8.4, 9.4, 9.2_

- [ ] 18. Frontend — Action Log and Policy Editor
  - [x] 18.1 Build Action Log page
    - Reverse chronological list with agent type, decision type, date filters
    - Expandable entries showing inputs, policy rules applied, outcome, reasoning
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 18.2 Build Policy Editor page
    - Policy rule list with create/edit/delete
    - Rule form with condition type, condition value, action type, action value
    - Rule templates for common scenarios (refund threshold, EMI eligibility, reminder timing)
    - Validation feedback (missing fields, conflicts)
    - _Requirements: 15.1, 15.2, 15.4_

- [x] 19. Final checkpoint — Full integration
  - Verify frontend connects to all backend APIs
  - Verify seed data displays correctly across all views
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (42 properties total)
- Unit tests validate specific examples and edge cases
- All backend code uses Knex.js (no raw SQLite SQL) for AWS RDS migration readiness
- Pine Labs service is a single mock file — swap for real SDK when ready
