# Requirements Document: Bidding Agent & Merchant Lifecycle Enhancements

## Introduction

This spec covers the major new feature additions to Iris: Merchant Lifecycle Management (formerly Project Iris reconciliation). The primary addition is the Bidding Agent — a new autonomous agent that handles incoming buyer bids for commodities, performs inventory checks, conducts agentic negotiations via a Bedrock-powered chat window, and auto-approves transactions based on configurable thresholds and buyer history. 

Secondary additions include: a new Account Page (detailed per-buyer status view), refinements to the existing Collection Agent and Deduction Agent to fit the full merchant lifecycle flow, and agentic chat capabilities for dispute artifact review.

The sample merchant context is a loose cloth wholesaler. The platform already has working Collection, Deduction, Treasury, and Dashboard pillars — this spec focuses exclusively on what is NEW or what must CHANGE.

## Glossary

- **Bidding_Agent**: The autonomous AI agent that receives buyer bids, checks inventory, conducts negotiations, and approves or rejects transactions
- **Buyer**: A customer who submits bids to purchase commodities from the Merchant (maps to existing Customer entity with extended fields)
- **Bid**: A purchase request from a Buyer specifying a commodity, quantity, and offered price
- **Commodity**: A product or material the Merchant sells (e.g., loose cloth types, fabric rolls)
- **Inventory**: The Merchant's current stock of Commodities with quantities and pricing
- **Negotiation_Session**: An agentic chat conversation between the Bidding_Agent and a Buyer to negotiate bid terms
- **Bedrock_Service**: The AWS Bedrock integration that powers agentic chat for negotiations and dispute artifact review
- **Auto_Approval_Threshold**: A Merchant-configured value below which the Bidding_Agent can approve transactions without human review
- **Credit_Line**: A deferred payment arrangement offered to a Buyer based on conversation context and past payment history
- **Payment_Link**: A Pine Labs-generated URL for immediate payment (existing concept, extended to bid transactions)
- **Account_Status**: A Buyer's overall standing — At Risk (red), Need Reminders (yellow), On Time (green)
- **Confidence_Score**: A numerical rating representing the Merchant's confidence in a Buyer's reliability (derived from payment history and transaction patterns)
- **Transaction_Record**: A record of a completed bid transaction including commodity, quantity, price, payment method, and shipping details
- **Shipping_Date**: The expected or actual date a fulfilled order ships to the Buyer
- **Course_of_Action**: The recommended follow-up for a transaction — None, Weekly Reminder, Daily Reminder, or Human Escalation
- **Artifact_Review**: The process where the Deduction_Agent uses agentic chat to review dispute evidence (photos, documents) and make resolution decisions

## Requirements

### Requirement 1: Commodity Inventory Management

**User Story:** As a Merchant, I want to manage my commodity inventory in the system, so that the Bidding_Agent can check stock availability when bids arrive.

#### Acceptance Criteria

1. THE system SHALL store Commodities in the database with name, description, unit (e.g., meters, rolls, pieces), available quantity, minimum price per unit, and maximum price per unit
2. WHEN a Merchant creates or updates a Commodity, THE system SHALL validate that minimum price is less than or equal to maximum price and available quantity is non-negative
3. WHEN the Bidding_Agent approves a transaction, THE system SHALL decrement the Commodity available quantity by the transacted quantity
4. IF a Bid requests a quantity exceeding available inventory, THEN THE Bidding_Agent SHALL reject the Bid and inform the Buyer of the available quantity
5. THE Dashboard SHALL display an inventory management view where the Merchant can add, edit, and view Commodities with current stock levels

### Requirement 2: Bid Submission and Intake

**User Story:** As a Buyer, I want to submit bids for commodities, so that I can initiate a purchase negotiation with the Merchant.

#### Acceptance Criteria

1. WHEN a Buyer submits a Bid, THE system SHALL create a Bid record with the Buyer reference, Commodity reference, requested quantity, offered price per unit, and submission timestamp
2. WHEN a Bid is received, THE Bidding_Agent SHALL perform an inventory check against the requested Commodity and quantity
3. WHEN inventory is sufficient for a Bid, THE Bidding_Agent SHALL initiate a Negotiation_Session with the Buyer
4. WHEN a Bid is created, THE Action_Log SHALL record the Bid details, inventory check result, and next action taken
5. THE system SHALL store all Bids with status tracking: submitted, negotiating, approved, rejected, expired

### Requirement 3: Agentic Negotiation Chat (Bidding)

**User Story:** As a Buyer, I want to negotiate bid terms through a chat interface, so that I can reach a mutually agreeable price and payment arrangement with the Merchant.

#### Acceptance Criteria

1. WHEN a Negotiation_Session starts, THE Bidding_Agent SHALL create a chat session powered by Bedrock_Service with the Bid context (commodity, quantity, offered price, Merchant price range)
2. WHEN the Buyer sends a message in the Negotiation_Session, THE Bidding_Agent SHALL respond with a counter-offer or acceptance based on the Merchant's pricing rules and the Buyer's history
3. WHILE a Negotiation_Session is active, THE Bidding_Agent SHALL have access to the Buyer's previous payment patterns, transaction history, and Confidence_Score
4. WHEN the Bidding_Agent and Buyer reach agreement on price and payment terms, THE Bidding_Agent SHALL finalize the Negotiation_Session and create a Transaction_Record
5. THE system SHALL store all Negotiation_Session messages with sender, content, and timestamp for audit purposes
6. IF a Negotiation_Session has no activity for 24 hours, THEN THE system SHALL mark the session as expired and update the Bid status to expired

### Requirement 4: Transaction Approval and Payment

**User Story:** As a Merchant, I want the Bidding_Agent to auto-approve transactions under a set value and offer appropriate payment methods, so that small deals close quickly and larger deals get proper review.

#### Acceptance Criteria

1. WHEN a negotiated transaction total is below the Auto_Approval_Threshold, THE Bidding_Agent SHALL auto-approve the transaction and generate a Pine Labs Payment_Link for the Buyer
2. WHEN a negotiated transaction total is below the Auto_Approval_Threshold and the Buyer has a strong payment history, THE Bidding_Agent SHALL offer a Credit_Line option as an alternative to immediate payment
3. WHEN a transaction is approved with a Payment_Link, THE system SHALL send the Payment_Link to the Buyer and track payment status
4. WHEN a transaction is approved with a Credit_Line, THE system SHALL create a credit record with the agreed amount, due date, and link the transaction to the Collection_Agent for tracking
5. WHEN a transaction total exceeds the Auto_Approval_Threshold, THE Bidding_Agent SHALL flag the transaction for Merchant review and notify the Merchant
6. WHEN a transaction is approved, THE Bidding_Agent SHALL record the transaction in the Treasury as an expected incoming cash flow
7. THE Action_Log SHALL record every approval decision with the transaction amount, payment method selected, Buyer history summary, and reasoning

### Requirement 5: Buyer Account Page

**User Story:** As a Merchant, I want a detailed account page for each Buyer, so that I can see their complete transaction history, payment status, and risk profile at a glance.

#### Acceptance Criteria

1. THE Account Page SHALL display for each Buyer: net transactions to date, net payment due, Account_Status, and Confidence_Score
2. THE Account Page SHALL display an individual transactions history table with columns: Description, Status, Course of Action, Amount Recovered, Shipping Dates, and Past Due Date
3. WHEN displaying transaction Status, THE system SHALL use the values: Fulfilled, Pending Full Payment, Pending Partial Payment, or Dispute Raised
4. WHEN displaying Account_Status, THE system SHALL use color-coded indicators: At Risk (red), Need Reminders (yellow), On Time (green)
5. WHEN displaying Course of Action, THE system SHALL show one of: None, Weekly Reminder, Daily Reminder, or Human Escalation
6. WHEN displaying Past Due Date, THE system SHALL show the number of days past the agreed payment due date (0 if not overdue)
7. THE system SHALL compute Confidence_Score from the Buyer's payment history, on-time payment rate, transaction volume, and dispute frequency
8. WHEN a Buyer's Account_Status changes, THE system SHALL log the change in the Action_Log with the previous and new status and contributing factors

### Requirement 6: Collection Agent Lifecycle Integration

**User Story:** As a Merchant, I want the Collection_Agent to automatically track credit line payments from bid transactions, so that credit-based deals are followed up without manual intervention.

#### Acceptance Criteria

1. WHEN a transaction is approved with a Credit_Line, THE Collection_Agent SHALL create a collection record and begin tracking the payment due date
2. WHEN a credit line payment due date approaches (7 days before), THE Collection_Agent SHALL send a reminder to the Buyer with a Pine Labs Payment_Link
3. WHEN a credit line payment is overdue, THE Collection_Agent SHALL escalate reminders following the existing friendly → firm → final escalation pattern
4. WHEN the Collection_Agent sends a credit line reminder, THE reminder SHALL include the original transaction details and the Pine Labs Payment_Link
5. THE Collection_Agent SHALL update the Buyer's Confidence_Score after each credit line payment event (paid on time, late, or missed)

### Requirement 7: Deduction Agent Agentic Chat Enhancement

**User Story:** As a Merchant, I want the Deduction_Agent to use an agentic chatbot to review dispute artifacts, so that disputes can be resolved faster with AI-assisted evidence analysis.

#### Acceptance Criteria

1. WHEN a Dispute has uploaded artifacts (photos, documents), THE Deduction_Agent SHALL initiate an Artifact_Review session powered by Bedrock_Service
2. WHEN the Bedrock_Service reviews artifacts, THE Deduction_Agent SHALL receive a structured assessment including: artifact validity, claim support level (strong, moderate, weak), and recommended resolution
3. WHEN the Artifact_Review recommends a resolution, THE Deduction_Agent SHALL apply the recommendation if it aligns with active Policy_Rules
4. WHEN a valid deduction is confirmed through Artifact_Review, THE Deduction_Agent SHALL initiate a refund via Pine Labs
5. THE Merchant SHALL have the option to override Artifact_Review decisions and perform Manual Resolution
6. THE Action_Log SHALL record all Artifact_Review assessments, recommendations, and final decisions with reasoning

### Requirement 8: Bedrock Service Integration

**User Story:** As a platform developer, I want a clean Bedrock service abstraction, so that all agentic chat capabilities (negotiation and artifact review) use a consistent, swappable AI backend.

#### Acceptance Criteria

1. THE Bedrock_Service SHALL expose a conversation API that accepts a system prompt, conversation history, and context parameters, and returns an AI-generated response
2. WHEN the Bidding_Agent initiates a negotiation, THE Bedrock_Service SHALL receive the Merchant's pricing rules, Buyer history, and commodity details as context
3. WHEN the Deduction_Agent initiates an Artifact_Review, THE Bedrock_Service SHALL receive the dispute details, uploaded artifact descriptions, and applicable Policy_Rules as context
4. THE Bedrock_Service SHALL be implemented as a mock for the prototype that returns structured responses based on input patterns
5. THE Bedrock_Service SHALL be architected as a single service file so that swapping from mock to real AWS Bedrock requires only replacing the service implementation and updating configuration
6. IF a Bedrock_Service call fails, THEN THE system SHALL retry with exponential backoff up to 3 attempts and log the failure in the Action_Log

### Requirement 9: Buyer Transaction History and Patterns

**User Story:** As a Merchant, I want the system to maintain comprehensive buyer transaction history, so that the Bidding_Agent can make informed decisions during negotiations.

#### Acceptance Criteria

1. THE system SHALL store each completed transaction with: Buyer reference, Commodity, quantity, agreed price, payment method (payment link or credit line), payment status, shipping date, and completion timestamp
2. WHEN the Bidding_Agent accesses Buyer history during negotiation, THE system SHALL provide: total transaction count, total transaction value, average payment time, on-time payment percentage, and active credit lines
3. THE system SHALL compute a Buyer reliability metric from transaction history that the Bidding_Agent uses to determine credit line eligibility
4. WHEN a Buyer has no prior transaction history, THE Bidding_Agent SHALL treat the Buyer as a new buyer and restrict payment options to Payment_Link only (no credit line)

### Requirement 10: Platform Renaming and Navigation Updates

**User Story:** As a user, I want the platform to reflect its new identity as "Iris: Merchant Lifecycle Management" with updated navigation, so that the interface matches the expanded scope.

#### Acceptance Criteria

1. THE Dashboard SHALL display the platform name as "Iris: Merchant Lifecycle Management" in the header
2. THE navigation SHALL include entries for: Dashboard, Bids, Inventory, Accounts, Invoices, Disputes, Treasury, Action Log, and Policy Editor
3. WHEN a user navigates to the Bids page, THE system SHALL display active bids, negotiation status, and bid history
4. WHEN a user navigates to the Inventory page, THE system SHALL display the commodity inventory management view
5. WHEN a user navigates to the Accounts page, THE system SHALL display a list of Buyers with Account_Status indicators and summary metrics
