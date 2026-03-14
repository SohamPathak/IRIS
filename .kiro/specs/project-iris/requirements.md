# Requirements Document: Project Iris

## Introduction

Project Iris is an AI-powered autonomous finance recovery and cash flow management platform designed for small businesses (₹10L–5Cr revenue). The platform uses autonomous AI agents to manage accounts receivable collection, dispute resolution, and treasury operations — with Pine Labs payment gateway integration for all payment processing. The system targets D2C brands, local service businesses, freelancers, and small manufacturers, enabling them to recover revenue and manage cash flow without manual intervention.

## Glossary

- **Collection_Agent**: The autonomous AI agent responsible for managing accounts receivable, sending reminders, and generating payment links
- **Deduction_Agent**: The autonomous AI agent responsible for handling refund requests, verifying claims, and resolving disputes
- **Treasury_Engine**: The component that tracks money movement, predicts cash flow, and generates financial alerts
- **Dashboard**: The web-based interface displaying cash flow data, risk scores, action logs, and policy configuration
- **Pine_Labs_Gateway**: The Pine Labs payment gateway integration used for collecting payments and processing refunds
- **Merchant**: The small business owner or operator using Project Iris
- **Customer**: A buyer or client of the Merchant who owes payment or raises a dispute
- **Invoice**: A record of money owed by a Customer to a Merchant, including amount, due date, and line items
- **Reminder**: An automated communication sent to a Customer regarding an outstanding Invoice
- **Escalation_Level**: The urgency tier of a Reminder — friendly, firm, or final notice
- **Payment_Link**: A Pine Labs-generated URL that allows a Customer to pay an outstanding Invoice
- **Payment_Plan**: An installment arrangement offered to a Customer who cannot pay the full Invoice amount at once
- **Dispute**: A claim raised by a Customer requesting a refund, replacement, or correction
- **Resolution**: The outcome of a Dispute — full refund, partial refund, replacement, or rejection
- **Policy_Rule**: A Merchant-defined rule that governs autonomous agent decisions (e.g., "auto-approve refunds under ₹500")
- **Risk_Score**: A numerical rating assigned to a Customer indicating default likelihood versus loyalty
- **Action_Log**: A timestamped record of every autonomous decision made by the system, including reasoning
- **Cash_Flow_Prediction**: A forecast of future money movement based on pending Invoices and expected Refunds
- **EMI**: Equated Monthly Installment — a Payment_Plan option for overdue Invoices

## Requirements

### Requirement 1: Invoice Tracking and Management

**User Story:** As a Merchant, I want the Collection_Agent to track all outstanding Invoices, so that I have a clear view of money owed to my business.

#### Acceptance Criteria

1. WHEN a Merchant creates an Invoice, THE Collection_Agent SHALL store the Invoice with amount, due date, Customer reference, and line items
2. WHEN an Invoice payment is received via Pine_Labs_Gateway, THE Collection_Agent SHALL mark the Invoice as paid and record the transaction timestamp
3. WHEN an Invoice due date passes without payment, THE Collection_Agent SHALL mark the Invoice as overdue
4. THE Dashboard SHALL display all Invoices grouped by status: pending, overdue, and paid
5. WHEN a partial payment is received, THE Collection_Agent SHALL update the Invoice balance and retain the Invoice in pending status

### Requirement 2: Automated Reminder Escalation

**User Story:** As a Merchant, I want the Collection_Agent to send automated reminders with escalating urgency, so that Customers are prompted to pay without my manual follow-up.

#### Acceptance Criteria

1. WHEN an Invoice becomes overdue, THE Collection_Agent SHALL send a friendly Reminder to the Customer within 24 hours
2. WHEN a friendly Reminder receives no response within 7 days, THE Collection_Agent SHALL escalate to a firm Reminder
3. WHEN a firm Reminder receives no response within 7 days, THE Collection_Agent SHALL escalate to a final notice Reminder
4. THE Collection_Agent SHALL include a Pine_Labs_Gateway Payment_Link in every Reminder sent to a Customer
5. WHEN the Collection_Agent sends a Reminder, THE Action_Log SHALL record the Reminder type, Customer, Invoice, and timestamp

### Requirement 3: Adaptive Reminder Strategy

**User Story:** As a Merchant, I want the Collection_Agent to learn which reminder style works best per Customer, so that collection rates improve over time.

#### Acceptance Criteria

1. WHEN a Customer pays after receiving a Reminder, THE Collection_Agent SHALL record the Reminder Escalation_Level and communication channel that led to payment
2. WHILE the Collection_Agent has historical payment response data for a Customer, THE Collection_Agent SHALL select the Reminder tone and channel with the highest historical success rate for that Customer
3. THE Collection_Agent SHALL maintain a per-Customer response profile containing success rates per Escalation_Level and channel

### Requirement 4: Payment Plan Offers

**User Story:** As a Merchant, I want the Collection_Agent to offer Payment_Plans to struggling Customers, so that I can recover revenue from Customers who cannot pay in full.

#### Acceptance Criteria

1. WHEN a Policy_Rule specifies "offer EMI if overdue > N days", THE Collection_Agent SHALL offer a Payment_Plan to the Customer after N days of non-payment
2. WHEN a Customer accepts a Payment_Plan, THE Collection_Agent SHALL generate recurring Pine_Labs_Gateway Payment_Links for each installment
3. WHEN a Payment_Plan installment is missed, THE Collection_Agent SHALL send a Reminder for the missed installment and flag the account
4. THE Collection_Agent SHALL calculate Payment_Plan installment amounts based on the outstanding Invoice balance and Merchant-configured EMI terms

### Requirement 5: High-Risk Account Flagging

**User Story:** As a Merchant, I want the Collection_Agent to flag high-risk accounts early, so that I can take proactive measures on likely defaults.

#### Acceptance Criteria

1. WHEN a Customer has overdue Invoices exceeding a Merchant-configured threshold, THE Collection_Agent SHALL flag the Customer as high-risk
2. WHEN a Customer's payment history shows a pattern of late payments, THE Collection_Agent SHALL increase the Customer's Risk_Score
3. WHEN a Customer is flagged as high-risk, THE Dashboard SHALL display the Customer prominently in a risk alert section
4. THE Collection_Agent SHALL compute Risk_Scores using payment history, overdue frequency, and average days-to-pay

### Requirement 6: Dispute Intake and Verification

**User Story:** As a Customer, I want to raise complaints via chat, so that I can request refunds or report issues without calling the Merchant.

#### Acceptance Criteria

1. WHEN a Customer initiates a Dispute via chat, THE Deduction_Agent SHALL create a Dispute record with the Customer's claim details
2. WHEN a Dispute is created, THE Deduction_Agent SHALL verify the claim by cross-referencing order details, delivery proof, and any uploaded photos
3. IF the Deduction_Agent cannot verify a claim due to missing information, THEN THE Deduction_Agent SHALL request the specific missing information from the Customer
4. THE Deduction_Agent SHALL complete claim verification within the data available without requiring Merchant intervention

### Requirement 7: Autonomous Dispute Resolution

**User Story:** As a Merchant, I want the Deduction_Agent to resolve disputes autonomously based on my policy rules, so that refunds and replacements are handled without my intervention.

#### Acceptance Criteria

1. WHEN a Dispute is verified, THE Deduction_Agent SHALL evaluate the claim against applicable Policy_Rules and select a Resolution: full refund, partial refund, replacement, or rejection
2. WHEN a Resolution is a full or partial refund, THE Deduction_Agent SHALL process the refund via Pine_Labs_Gateway
3. WHEN a Resolution is determined, THE Action_Log SHALL record the Dispute, the selected Resolution, the Policy_Rules applied, and the reasoning
4. WHEN a Customer disputes a Resolution, THE Deduction_Agent SHALL re-evaluate the claim with any new information provided by the Customer
5. WHEN a Dispute is resolved, THE Deduction_Agent SHALL notify the Merchant with a summary of the Dispute and Resolution
6. WHEN a Policy_Rule specifies "auto-approve refunds under ₹X", THE Deduction_Agent SHALL approve refunds at or below ₹X without additional review

### Requirement 8: Money Movement Tracking

**User Story:** As a Merchant, I want the Treasury_Engine to track all money movement, so that I have a unified view of incoming collections and outgoing refunds.

#### Acceptance Criteria

1. WHEN a payment is received via Pine_Labs_Gateway, THE Treasury_Engine SHALL record the transaction as an incoming cash flow entry
2. WHEN a refund is processed via Pine_Labs_Gateway, THE Treasury_Engine SHALL record the transaction as an outgoing cash flow entry
3. THE Treasury_Engine SHALL maintain a running net cash flow balance computed as total incoming minus total outgoing
4. THE Dashboard SHALL display money movement in a timeline view showing individual transactions and running balance

### Requirement 9: Cash Flow Prediction

**User Story:** As a Merchant, I want the Treasury_Engine to predict future cash flow, so that I can plan my finances based on expected income and outgoings.

#### Acceptance Criteria

1. THE Treasury_Engine SHALL generate Cash_Flow_Predictions based on pending Invoice amounts, expected payment dates, and anticipated refund volumes
2. WHEN a Cash_Flow_Prediction indicates a negative balance within 30 days, THE Treasury_Engine SHALL generate a cash flow risk alert
3. THE Treasury_Engine SHALL update Cash_Flow_Predictions daily to reflect new Invoices, payments, and Disputes
4. THE Dashboard SHALL display Cash_Flow_Predictions as a chart showing projected incoming and outgoing amounts over the next 90 days

### Requirement 10: Cash Flow Risk Alerts

**User Story:** As a Merchant, I want to receive alerts on cash flow risks, so that I can act before financial problems escalate.

#### Acceptance Criteria

1. WHEN the ratio of refunds to collections exceeds a Merchant-configured threshold in a rolling 30-day window, THE Treasury_Engine SHALL generate a "high refund ratio" alert
2. WHEN the average days-to-pay across all Customers increases beyond a Merchant-configured threshold, THE Treasury_Engine SHALL generate a "slow collections" alert
3. WHEN a cash flow risk alert is generated, THE Dashboard SHALL display the alert with severity level and recommended actions
4. THE Treasury_Engine SHALL suggest optimal timing for sending collection Reminders based on historical payment patterns

### Requirement 11: Dashboard — Net Cash Flow View

**User Story:** As a Merchant, I want a net cash flow view on the Dashboard, so that I can see money coming in versus going out at a glance.

#### Acceptance Criteria

1. THE Dashboard SHALL display a net cash flow summary showing total collections, total refunds, and net balance for a Merchant-selected time period
2. WHEN the Merchant selects a time period filter, THE Dashboard SHALL update all cash flow figures to reflect the selected range
3. THE Dashboard SHALL update cash flow data in real-time as new transactions are processed via Pine_Labs_Gateway

### Requirement 12: Customer Risk Scoring

**User Story:** As a Merchant, I want risk scoring for each Customer, so that I can distinguish between default-risk and loyal buyers.

#### Acceptance Criteria

1. THE Dashboard SHALL display a Risk_Score for each Customer, categorized as low, medium, or high risk
2. WHEN a Customer's Risk_Score changes category, THE Dashboard SHALL highlight the change and provide the contributing factors
3. THE Collection_Agent SHALL use Risk_Scores to prioritize collection efforts, contacting high-risk Customers first

### Requirement 13: Autonomous Action Log

**User Story:** As a Merchant, I want to see every decision the AI agents made and why, so that I can audit autonomous actions and build trust in the system.

#### Acceptance Criteria

1. THE Action_Log SHALL record every autonomous decision made by the Collection_Agent and Deduction_Agent, including the decision type, inputs, Policy_Rules applied, and outcome
2. WHEN a Merchant views the Action_Log on the Dashboard, THE Dashboard SHALL display entries in reverse chronological order with filtering by agent type, decision type, and date range
3. THE Action_Log SHALL include a human-readable reasoning summary for each decision explaining why the agent chose that action

### Requirement 14: Policy Editor

**User Story:** As a Merchant, I want to set rules that govern autonomous agent behavior, so that the agents operate within my business preferences.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a Policy Editor interface where the Merchant can create, edit, and delete Policy_Rules
2. WHEN a Merchant creates a Policy_Rule, THE Dashboard SHALL validate that the rule has a condition, an action, and no conflicts with existing rules
3. WHEN a Policy_Rule is updated, THE Collection_Agent and Deduction_Agent SHALL apply the updated rule to all subsequent decisions immediately
4. THE Policy Editor SHALL support rule templates for common scenarios including: refund thresholds, EMI eligibility criteria, and reminder timing

### Requirement 15: Pine Labs Gateway Integration

**User Story:** As a Merchant, I want all payments and refunds processed through Pine Labs, so that I have a single reliable payment channel.

#### Acceptance Criteria

1. WHEN the Collection_Agent generates a Payment_Link, THE Pine_Labs_Gateway integration SHALL create a valid payment URL with the correct amount and Invoice reference
2. WHEN a payment is completed via a Payment_Link, THE Pine_Labs_Gateway integration SHALL send a payment confirmation callback to the Collection_Agent within 60 seconds
3. WHEN the Deduction_Agent initiates a refund, THE Pine_Labs_Gateway integration SHALL process the refund and return a transaction reference
4. IF a Pine_Labs_Gateway API call fails, THEN THE system SHALL retry the call with exponential backoff up to 3 attempts and log the failure in the Action_Log
5. THE Pine_Labs_Gateway integration SHALL validate all API responses and reject malformed or unauthorized responses
