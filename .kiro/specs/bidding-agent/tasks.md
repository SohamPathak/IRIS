# Implementation Plan: Bidding Agent & Merchant Lifecycle Enhancements

## Overview

Incremental build extending the existing Iris platform. Starts with new database tables and models, then builds the Bedrock service, Bidding Agent, account aggregation, Collection/Deduction agent extensions, new API routes, and finally new frontend pages. Each step produces working, testable code that integrates with the existing codebase.

## Tasks

- [x] 1. Database migration and core models
  - [x] 1.1 Create migration for new tables
    - Create `server/src/migrations/20240102000000_bidding_agent.js`
    - Add 7 tables: commodities, bids, negotiation_sessions, negotiation_messages, transaction_records, credit_lines, dispute_artifacts
    - Apply all data constraints (enums, foreign keys, defaults) per design document
    - _Requirements: 1.1, 2.1, 2.5, 3.5, 9.1_

  - [x] 1.2 Create commodity model
    - Create `server/src/models/commodity.js` with Knex queries
    - CRUD operations: create, read (with filters), update, getById
    - Validation: min_price <= max_price, available_quantity >= 0
    - Decrement quantity method for transaction approval
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 1.3 Write property tests for commodity model
    - **Property 1: Commodity round-trip persistence**
    - **Validates: Requirements 1.1**
    - **Property 2: Commodity validation rejects invalid pricing and quantity**
    - **Validates: Requirements 1.2**

  - [x] 1.4 Create bid model
    - Create `server/src/models/bid.js` with Knex queries
    - CRUD operations: create, read (with status filters), update status, getById
    - Status values: submitted, negotiating, approved, rejected, expired
    - _Requirements: 2.1, 2.5_

  - [x] 1.5 Create negotiation model
    - Create `server/src/models/negotiation.js` with Knex queries
    - Session CRUD: create session with context_json, update status, get with messages
    - Message CRUD: add message (sender, content), list messages by session
    - _Requirements: 3.1, 3.5_

  - [x] 1.6 Create transaction record and credit line models
    - Create `server/src/models/transactionRecord.js` with Knex queries
    - Create `server/src/models/creditLine.js` with Knex queries
    - Transaction record: create, read, update payment status
    - Credit line: create, read, update status, get by buyer
    - _Requirements: 9.1, 4.4, 6.1_

  - [ ]* 1.7 Write property tests for bid and transaction record models
    - **Property 4: Bid creation round-trip with valid status**
    - **Validates: Requirements 2.1, 2.5**
    - **Property 28: Transaction record round-trip persistence**
    - **Validates: Requirements 9.1**

- [x] 2. Checkpoint — Database and models
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Bedrock service mock
  - [x] 3.1 Implement Bedrock service abstraction and mock
    - Create `server/src/services/bedrockService.js` following Pine Labs mock pattern
    - `chat(systemPrompt, conversationHistory, context)` — returns AI response based on input patterns
    - `reviewArtifacts(disputeDetails, artifactDescriptions, policyRules)` — returns structured assessment
    - Mock negotiation logic: accept if price >= min, counter-offer if within 20%, reject if < 80% min
    - Mock artifact review: strong/moderate/weak based on claim detail length and artifact presence
    - Retry with exponential backoff (3 attempts), same as Pine Labs
    - 200ms simulated delay
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 3.2 Write property tests for Bedrock service
    - **Property 26: Bedrock service returns response for valid inputs**
    - **Validates: Requirements 8.1**
    - **Property 27: Bedrock service retry on failure**
    - **Validates: Requirements 8.6**

- [x] 4. Bidding Agent — core logic
  - [x] 4.1 Implement Bidding Agent bid processing
    - Create `server/src/agents/biddingAgent.js`
    - `processBid(bidData)` — validates bid, checks inventory, creates bid record, initiates negotiation if inventory sufficient, rejects if insufficient
    - Log all actions to action_logs with agent_type 'bidding'
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 1.4_

  - [ ]* 4.2 Write property tests for bid processing
    - **Property 3: Inventory consistency on bid processing**
    - **Validates: Requirements 1.3, 1.4**
    - **Property 5: Negotiation session created with bid context for sufficient inventory**
    - **Validates: Requirements 2.3, 3.1**
    - **Property 6: Bid processing logged to action log**
    - **Validates: Requirements 2.4**

  - [x] 4.3 Implement negotiation message handling
    - `handleNegotiationMessage(sessionId, buyerMessage)` — sends to Bedrock with context, stores both messages, checks for agreement
    - `getBuyerHistory(buyerId)` — returns transaction count, total value, avg payment time, on-time %, active credit lines
    - Pass buyer history and commodity pricing to Bedrock as context
    - _Requirements: 3.2, 3.3, 3.4, 9.2_

  - [ ]* 4.4 Write property tests for negotiation
    - **Property 7: Negotiation message round-trip**
    - **Validates: Requirements 3.2, 3.5**
    - **Property 8: Negotiation finalization creates transaction record**
    - **Validates: Requirements 3.4**
    - **Property 29: Buyer history returns complete metrics**
    - **Validates: Requirements 9.2**

  - [x] 4.5 Implement transaction approval and payment
    - `finalizeTransaction(sessionId, agreedPrice, paymentMethod)` — creates transaction record, decrements inventory
    - `checkCreditEligibility(buyerId)` — checks buyer history, new buyers get payment_link only
    - Auto-approve under threshold with payment link or credit line
    - Flag for merchant review if over threshold
    - Record in treasury as incoming cash flow
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 1.3, 9.3, 9.4_

  - [ ]* 4.6 Write property tests for transaction approval
    - **Property 10: Auto-approval threshold determines approval path**
    - **Validates: Requirements 4.1, 4.5**
    - **Property 11: Credit line eligibility based on buyer history**
    - **Validates: Requirements 4.2, 9.4**
    - **Property 12: Credit line record creation on credit transactions**
    - **Validates: Requirements 4.4, 6.1**
    - **Property 13: Approved transactions recorded in treasury**
    - **Validates: Requirements 4.6**
    - **Property 14: Approval decisions logged with full context**
    - **Validates: Requirements 4.7**

  - [x] 4.7 Implement stale negotiation expiry
    - `expireStaleNegotiations()` — marks sessions with no activity for 24h as expired, updates bid status
    - _Requirements: 3.6_

  - [ ]* 4.8 Write property test for negotiation expiry
    - **Property 9: Stale negotiation expiry**
    - **Validates: Requirements 3.6**

- [x] 5. Checkpoint — Bidding Agent complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Account page model and confidence scoring
  - [x] 6.1 Implement account aggregation model
    - Create `server/src/models/account.js`
    - `getBuyerAccountSummary(buyerId)` — returns net_transactions, net_payment_due, account_status, confidence_score
    - `getBuyerTransactionHistory(buyerId)` — returns rows with description, status, course_of_action, amount_recovered, shipping_dates, past_due_days
    - `computeAccountStatus(buyerId)` — At Risk / Need Reminders / On Time based on overdue days and confidence
    - `computeConfidenceScore(buyerId)` — formula from design (base 50, bonuses/penalties, clamped [0,100])
    - `determineCourseOfAction(transactionRecord)` — None / Weekly / Daily / Human Escalation based on overdue days
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]* 6.2 Write property tests for account model
    - **Property 15: Account summary contains required fields**
    - **Validates: Requirements 5.1**
    - **Property 16: Transaction history contains required columns**
    - **Validates: Requirements 5.2, 5.3, 5.5, 5.6**
    - **Property 17: Confidence score range and computation**
    - **Validates: Requirements 5.7, 9.3**

- [x] 7. Collection Agent extensions
  - [x] 7.1 Add credit line tracking to Collection Agent
    - Add `trackCreditLine(creditLineId)` to `server/src/agents/collectionAgent.js`
    - Add `handleCreditLinePayment(creditLineId, paymentData)` — records payment, updates status, updates confidence score
    - Add `escalateCreditLineReminders()` — applies friendly→firm→final to overdue credit lines
    - Send reminder 7 days before due date with Pine Labs payment link and transaction details
    - Log account status changes to action_log
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 5.8_

  - [ ]* 7.2 Write property tests for credit line collection
    - **Property 18: Account status change logging**
    - **Validates: Requirements 5.8**
    - **Property 19: Credit line reminders contain payment link and transaction details**
    - **Validates: Requirements 6.2, 6.4**
    - **Property 20: Credit line escalation follows state machine**
    - **Validates: Requirements 6.3**
    - **Property 21: Confidence score updated after credit line payment events**
    - **Validates: Requirements 6.5**

- [x] 8. Deduction Agent extensions
  - [x] 8.1 Add artifact review to Deduction Agent
    - Add `reviewArtifacts(disputeId)` to `server/src/agents/deductionAgent.js`
    - Fetch dispute artifacts from dispute_artifacts table
    - Send to Bedrock service for AI review
    - Apply recommendation if aligned with policy rules
    - Process Pine Labs refund for valid deductions
    - Add `manualResolution(disputeId, resolution, merchantNotes)` for merchant override
    - Log all assessments and decisions to action_log
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 8.2 Write property tests for artifact review
    - **Property 22: Artifact review produces structured assessment**
    - **Validates: Requirements 7.1, 7.2**
    - **Property 23: Artifact review resolution aligned with policy**
    - **Validates: Requirements 7.3**
    - **Property 24: Valid deduction triggers Pine Labs refund**
    - **Validates: Requirements 7.4**
    - **Property 25: Artifact review logged to action log**
    - **Validates: Requirements 7.6**

- [x] 9. Checkpoint — All agent logic complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. API routes
  - [x] 10.1 Create commodity API routes
    - Create `server/src/routes/commodities.js`
    - GET `/api/v1/commodities` — list with stock levels
    - GET `/api/v1/commodities/:id` — detail
    - POST `/api/v1/commodities` — create with validation
    - PUT `/api/v1/commodities/:id` — update with validation
    - Wire to app.js
    - _Requirements: 1.1, 1.2, 1.5_

  - [x] 10.2 Create bid API routes
    - Create `server/src/routes/bids.js`
    - GET `/api/v1/bids` — list with status filters
    - GET `/api/v1/bids/:id` — detail with negotiation
    - POST `/api/v1/bids` — submit new bid (triggers Bidding Agent)
    - PATCH `/api/v1/bids/:id/approve` — merchant manual approval
    - Wire to app.js
    - _Requirements: 2.1, 2.5, 4.5, 10.3_

  - [x] 10.3 Create negotiation API routes
    - Create `server/src/routes/negotiations.js`
    - GET `/api/v1/negotiations/:id` — get session with messages
    - POST `/api/v1/negotiations/:id/messages` — send message (triggers Bidding Agent response)
    - Wire to app.js
    - _Requirements: 3.2, 3.5_

  - [x] 10.4 Create account API routes
    - Create `server/src/routes/accounts.js`
    - GET `/api/v1/accounts` — list buyer accounts with status
    - GET `/api/v1/accounts/:buyerId` — detailed buyer account page
    - GET `/api/v1/accounts/:buyerId/transactions` — buyer transaction history
    - Wire to app.js
    - _Requirements: 5.1, 5.2, 10.5_

  - [x] 10.5 Wire new routes to app.js and update dispute routes
    - Import and mount commodity, bid, negotiation, account routes in `server/src/app.js`
    - Add artifact upload endpoint to existing dispute routes: POST `/api/v1/disputes/:id/artifacts`
    - Add artifact review trigger: POST `/api/v1/disputes/:id/artifact-review`
    - Add manual resolution endpoint: POST `/api/v1/disputes/:id/manual-resolve`
    - _Requirements: 7.1, 7.5_

- [x] 11. Seed data extensions
  - [x] 11.1 Extend seed script with bidding agent data
    - Add to `server/src/seed/seedDatabase.js`
    - 10 commodities per merchant (cloth types with realistic pricing in INR)
    - 30 bids across various statuses
    - 15 completed transaction records with mixed payment methods
    - 5 active credit lines
    - Sample negotiation sessions with 3-5 messages each
    - Dispute artifacts for existing disputes
    - _Requirements: 1.1, 2.1, 9.1_

- [x] 12. Checkpoint — All backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Frontend — Layout updates and new pages
  - [x] 13.1 Update Layout component with new branding and navigation
    - Update `client/src/components/Layout.jsx`
    - Change title to "Iris: Merchant Lifecycle Management"
    - Change subtitle to "Merchant Lifecycle Management"
    - Add nav items: Bids, Inventory, Accounts
    - Reorder nav: Dashboard, Bids, Inventory, Accounts, Invoices, Disputes, Treasury, Action Log, Policy Editor
    - _Requirements: 10.1, 10.2_

  - [x] 13.2 Build Inventory page
    - Create `client/src/pages/Inventory.jsx`
    - Commodity table with name, unit, available quantity, min/max price
    - Add/edit commodity form with validation
    - Stock level indicators
    - _Requirements: 1.5, 10.4_

  - [x] 13.3 Build Bids page
    - Create `client/src/pages/Bids.jsx`
    - Bid list with status filters (submitted, negotiating, approved, rejected, expired)
    - Bid detail view with commodity info and negotiation status
    - Manual approve action for flagged bids
    - _Requirements: 2.5, 10.3_

  - [x] 13.4 Build Negotiation Chat component
    - Create `client/src/components/NegotiationChat.jsx`
    - Chat message list with sender indicators (buyer vs agent)
    - Message input and send functionality
    - Real-time-style polling for new messages
    - Session status display (active, completed, expired)
    - _Requirements: 3.2, 3.5_

  - [x] 13.5 Build Accounts page
    - Create `client/src/pages/Accounts.jsx`
    - Buyer list with Account_Status color indicators (red/yellow/green)
    - Summary metrics per buyer (net transactions, payment due, confidence score)
    - Buyer detail view with full transaction history table
    - Transaction history columns: Description, Status, Course of Action, Amount Recovered, Shipping Dates, Past Due Date
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 10.5_

  - [x] 13.6 Update App.jsx with new routes
    - Add routes for /bids, /inventory, /accounts, /accounts/:buyerId
    - Import new page components
    - _Requirements: 10.2_

- [x] 14. Frontend — Dispute page artifact upload
  - [x] 14.1 Add artifact upload and review UI to Disputes page
    - Update `client/src/pages/Disputes.jsx`
    - Add artifact upload section (file description, type selector)
    - Add "AI Review" button to trigger artifact review
    - Display review assessment (validity, support level, recommendation)
    - Add "Manual Resolution" form for merchant override
    - _Requirements: 7.1, 7.5_

- [x] 15. Final checkpoint — Full integration
  - Verify all new frontend pages connect to backend APIs
  - Verify seed data displays correctly in Bids, Inventory, and Accounts pages
  - Verify negotiation chat flow works end-to-end
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (29 properties total)
- All new backend code follows existing patterns: Knex.js models, Express routes, agent classes
- Bedrock service is a mock (same pattern as Pine Labs) — swap for real AWS Bedrock when ready
- Existing Treasury, threat detection, and dashboard summary systems remain unchanged
