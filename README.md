# 🔮 Project Iris — AI-Powered Merchant Lifecycle Management

> **Hackathon Theme**: Agentic / Autonomous Commerce & Intelligent Payments
> **Status**: ✅ Demo Ready | **Stack**: React + Node.js + AWS Bedrock + Pine Labs

---

## The Problem

**₹7.34 Lakh Crore (~$88 Billion) is stuck in delayed payments owed to Indian MSMEs.**

| Metric | Value |
|--------|-------|
| Average days to collect payment in India | 57 days (global avg: 45) |
| B2B payments overdue 90+ days | 52% in major cities |
| Invoices that go overdue for micro-enterprises | 65.73% |
| SMBs that fail due to cash flow | 82% |
| Hours/week small business owners spend chasing payments | 14 |
| MSMEs shut down since 2020 | 61,469 |

Small merchants don't have finance teams. They use Tally or Zoho to track invoices — but tracking doesn't collect money. Debt collectors charge 15-50% and burn relationships. Legal routes are slow. The result: merchants bleed cash, relationships, and eventually their business.

---

## What Iris Does

Iris is a single platform with **five autonomous modules**, each solving a specific cash flow problem. Every module connects to **Pine Labs** for real payment processing and **AWS Bedrock (Claude)** for AI decision-making.

---

### Module 1: Bidding Agent 🤝

**Problem**: Merchants negotiate deals over WhatsApp and phone calls. No price discipline, no inventory checks, no paper trail. Deals fall through or get agreed at a loss.

**How Iris solves it**:
- Buyer submits a bid (commodity, quantity, price) through the platform
- Agent checks real-time inventory — rejects immediately if stock is insufficient
- Opens an **AI-powered negotiation chat** (Bedrock/Claude) that negotiates on behalf of the merchant
- Claude follows the merchant's price range rules — accepts, counters, or rejects based on min/max pricing
- Checks buyer history (past transactions, on-time payment %) to decide payment terms
- Trusted buyers (5+ transactions, >80% on-time) get offered a **30-day credit line**
- New buyers get a **Pine Labs payment link** — pay now to confirm
- Transaction auto-approved if below merchant's threshold; flagged for review if above
- Inventory decremented, transaction recorded, treasury updated — all in one flow

**What this replaces**: WhatsApp haggling, manual inventory checks, handshake deals with no records.

---

### Module 2: Collection Agent 🔵

**Problem**: Once goods are shipped and invoiced, getting paid is a manual grind. Merchants send reminders inconsistently, forget to follow up, or give up after one attempt. 14 hours/week wasted.

**How Iris solves it**:
- Tracks every invoice (amount, due date, customer, line items, partial payments)
- When an invoice goes overdue, the Collection Agent activates within 24 hours
- Sends **adaptive reminders** with escalating urgency: Friendly → Firm → Final Notice
- Learns which reminder style works for each customer (email vs SMS, friendly vs firm)
- Each reminder includes a **Pine Labs payment link** — one tap to pay
- If customer can't pay in full, agent offers **EMI/payment plans** per merchant policy, each installment with its own payment link
- Flags high-risk accounts early using AI-computed risk scores
- Every action logged with reasoning — full audit trail

**What this replaces**: Manual phone calls, forgotten follow-ups, inconsistent collection efforts, hiring a collections person.

---

### Module 3: Deduction Agent ⚖️

**Problem**: Customer disputes and refund requests eat into revenue. Merchants either over-refund to keep the peace or ignore disputes and lose customers. No structured process.

**How Iris solves it**:
- Customers raise disputes through the portal — no phone calls needed
- AI (Bedrock/Claude) reviews the claim by cross-referencing order details, delivery proof, and uploaded artifacts (photos, documents)
- Evaluates against **merchant-defined policy rules** (e.g., "auto-approve refunds under ₹500", "require photo evidence for damage claims")
- Resolves autonomously: full refund, partial refund, replacement, or rejection
- Refunds processed via **Pine Labs Refund API** — money returned to customer's original payment method
- Every decision logged with full reasoning and policy rules applied
- Threat Detector monitors for refund spikes (potential fraud)

**What this replaces**: Ad-hoc refund decisions, no policy enforcement, revenue leakage from over-refunding, no fraud detection.

---

### Module 4: Treasury Engine 💰

**Problem**: Merchants don't know their real-time cash position. Money comes in from collections, goes out as refunds, but there's no unified view. Cash flow surprises kill businesses.

**How Iris solves it**:
- Tracks every rupee — incoming (collections, bid payments) and outgoing (refunds, credit line payouts)
- Maintains a **running net cash flow balance** updated in real-time
- Generates **90-day cash flow predictions** based on pending invoices, expected payments, and anticipated refunds
- Alerts when predicted balance goes negative within 30 days
- Timeline view of all money movement with drill-down to individual transactions
- Charts: daily/weekly/monthly cash flow trends via Recharts

**What this replaces**: Spreadsheet cash tracking, end-of-month surprises, no forward visibility.

---

### Module 5: Threat Detector & Risk Scoring 🚨

**Problem**: Financial risks sneak up on merchants. A customer slowly paying later and later. Refund rates creeping up. A buyer who always disputes. By the time the merchant notices, the damage is done.

**How Iris solves it**:
- Detects **high refund-to-collection ratios** — are you giving back more than you're collecting?
- Flags **slow collection trends** — average days-to-pay increasing across customers
- Identifies **potential fraud** — customer with sudden spike in refund requests
- Spots **unusual payment patterns** — multiple payment failures, rapid successive refunds
- Every threat gets a severity rating: Low → Medium → High → Critical
- AI-generated **Quick Summary** — your business health in under 200 words: what's working, what needs attention, recommended actions
- Per-customer **risk scores** (0-100) computed from payment history, dispute frequency, and credit line repayment
- Accounts categorized: 🟢 On Time | 🟡 Need Reminders | 🔴 At Risk

**What this replaces**: Gut feeling, noticing problems too late, no early warning system.

---

## Pine Labs Integration — The Payment Backbone

Every module connects to Pine Labs (Plural) for real payment processing:

| Touchpoint | Pine Labs Feature Used |
|-----------|----------------------|
| Bid accepted → buyer pays | Payment Link (Create Order → Payment Link API) |
| Credit line issued → buyer pays later | Payment Link with 30-day expiry |
| Invoice reminder sent | Payment Link embedded in reminder |
| EMI plan created | Individual Payment Links per installment |
| Dispute resolved as refund | Refund API (full or partial) |
| Payment confirmed | Webhook callback → invoice/transaction status updated |

**Integration**: OAuth2 token auth, Create Order + Payment Link two-step flow, Refund API. UAT environment (`pluraluat.v2.pinepg.in`) for demo, production-ready architecture for swap to live.

---

## AWS Bedrock Integration — The AI Brain

| Use Case | How Bedrock Is Used |
|----------|-------------------|
| Bid negotiation | Claude conducts multi-turn price negotiation, follows merchant's min/max rules, decides accept/counter/reject |
| Dispute resolution | Claude reviews dispute artifacts, cross-references order data, recommends resolution |
| Business summary | AI generates natural-language health summary from treasury and threat data |

**Model**: `us.anthropic.claude-3-5-haiku-20241022-v1:0` via Bedrock Runtime SDK. Structured JSON responses with decision + message + pricing. Fallback to mock logic when credentials not configured.

---

## Technical Architecture

| Layer | Technology | Role |
|-------|-----------|------|
| Frontend | React 18 + Vite + Tailwind CSS | Single-page app with real-time dashboards, charts (Recharts), and negotiation chat UI |
| Backend | Node.js + Express.js | REST API server with modular routes, middleware (auth, validation, error handling) |
| Database | SQLite + Knex.js | Lightweight relational DB with migrations, query builder, and seed data |
| AI Engine | AWS Bedrock (Claude 3.5 Haiku) | Multi-turn negotiation, dispute resolution, business health summaries |
| Payments | Pine Labs Plural API (UAT) | Payment link generation, refund processing, webhook callbacks |
| Auth | Session-based (sessionStorage) | Lightweight login gate — persists on refresh, clears on tab close |

### System Flow

```
┌─────────────┐     REST API      ┌──────────────┐     Knex.js     ┌──────────┐
│  React App  │ ◄──────────────► │  Express.js  │ ◄────────────► │  SQLite  │
│  (Vite)     │                   │  Server      │                 │  (iris.db)│
└─────────────┘                   └──────┬───────┘                 └──────────┘
                                         │
                          ┌──────────────┼──────────────┐
                          ▼              ▼              ▼
                   ┌────────────┐ ┌───────────┐ ┌────────────┐
                   │  Bedrock   │ │ Pine Labs │ │  Agents &  │
                   │  (Claude)  │ │ (Plural)  │ │  Engines   │
                   └────────────┘ └───────────┘ └────────────┘
```

### Autonomous Agent Flows

**Collection Flow** — Invoice goes overdue → Agent activates within 24 hours → Sends adaptive reminder with Pine Labs payment link → Escalates tone if unpaid → Offers EMI plan → Flags to merchant if all attempts fail.

**Dispute Flow** — Customer raises dispute → Deduction Agent reviews claim + artifacts → Cross-references order data against merchant policy rules → Auto-resolves (refund/partial/reject) → Processes refund via Pine Labs if approved → Logs decision with reasoning.

**Treasury Flow** — Every payment, refund, and credit line event feeds into Treasury Engine → Running balance updated → 90-day forecast recalculated → Alerts triggered if projected balance goes negative within 30 days.

**Bidding Flow** — Buyer submits bid → Agent checks inventory → Opens AI negotiation (Claude) → Follows merchant's price rules → Checks buyer trust score → Offers credit line or generates Pine Labs payment link → Finalizes transaction → Updates inventory + treasury.

---

## How to Run the Demo

```bash
# 1. Clone and install
npm install
cd server && npm install
cd ../client && npm install

# 2. Set up environment (.env in root)
#    AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
#    PINELABS_CLIENT_ID, PINELABS_CLIENT_SECRET, PINELABS_MID

# 3. Run database migrations + seed
cd server && npx knex migrate:latest --knexfile src/knexfile.js
npx knex seed:run --knexfile src/knexfile.js

# 4. Start both servers
cd server && npm run dev          # Backend on :3001
cd client && npm run dev          # Frontend on :5173
```

Open `http://localhost:5173` → Login → Dashboard shows live metrics, navigate to any module.

---

## What's Next

| Phase | Focus |
|-------|-------|
| **Phase 1** (Current) | Working demo with all 5 modules, Pine Labs UAT, Bedrock AI |
| **Phase 2** | WhatsApp/SMS integration for reminders, multi-language support |
| **Phase 3** | Production Pine Labs credentials, real merchant onboarding |
| **Phase 4** | Mobile app, Tally/Zoho import, multi-merchant SaaS mode |

---

> **Built for the hackathon. Designed for production.**
> Iris turns a ₹7.34 Lakh Crore problem into an autonomous, AI-powered solution — one merchant at a time.
