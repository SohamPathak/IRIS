/**
 * Bidding Agent — handles bid intake, inventory checks, negotiation orchestration,
 * transaction approval, and credit line decisions.
 *
 * Requirements: 2.1–2.4, 3.1–3.6, 4.1–4.7, 1.3, 1.4, 9.2–9.4
 */
import db from '../db.js';
import * as CommodityModel from '../models/commodity.js';
import * as BidModel from '../models/bid.js';
import * as NegotiationModel from '../models/negotiation.js';
import * as TransactionRecordModel from '../models/transactionRecord.js';
import * as CreditLineModel from '../models/creditLine.js';
import bedrockService from '../services/bedrockService.js';
import pinelabsService from '../services/pinelabsService.js';

const DEFAULT_AUTO_APPROVAL_THRESHOLD = 50000; // ₹50,000

class BiddingAgent {
  /**
   * Process an incoming bid: validate, check inventory, create bid, initiate negotiation.
   * Requirements: 2.1, 2.2, 2.3, 2.4, 1.4
   */
  async processBid(bidData) {
    const { buyer_id, commodity_id, merchant_id, requested_quantity, offered_price_per_unit } = bidData;

    // Fetch commodity for inventory check
    const commodity = await CommodityModel.getById(commodity_id);
    if (!commodity) {
      await this._logAction(merchant_id, 'bid_rejected', bidData, 'Commodity not found');
      throw new Error('Commodity not found');
    }

    // Create bid record
    const bid = await BidModel.create({ buyer_id, commodity_id, merchant_id, requested_quantity, offered_price_per_unit });

    // Inventory check
    if (requested_quantity > commodity.available_quantity) {
      await BidModel.updateStatus(bid.id, 'rejected');
      await this._logAction(merchant_id, 'bid_rejected', {
        bid_id: bid.id, ...bidData, available_quantity: commodity.available_quantity,
      }, `Insufficient inventory: requested ${requested_quantity}, available ${commodity.available_quantity}`);
      return { bid: await BidModel.getById(bid.id), status: 'rejected', reason: 'insufficient_inventory', available_quantity: commodity.available_quantity };
    }

    // Inventory sufficient — initiate negotiation
    await BidModel.updateStatus(bid.id, 'negotiating');

    const context = {
      commodity: { name: commodity.name, unit: commodity.unit },
      priceRange: { min: commodity.min_price_per_unit, max: commodity.max_price_per_unit },
      offeredPrice: offered_price_per_unit,
      requestedQuantity: requested_quantity,
    };

    const systemPrompt = `You are a negotiation agent for a ${commodity.name} wholesaler. The price range is ₹${commodity.min_price_per_unit}–₹${commodity.max_price_per_unit} per ${commodity.unit}. The buyer is offering ₹${offered_price_per_unit} for ${requested_quantity} ${commodity.unit}.`;

    const session = await NegotiationModel.createSession({
      bid_id: bid.id, buyer_id, merchant_id, system_prompt: systemPrompt, context_json: context,
    });

    // Session created — buyer will send the first message via chat UI
    await this._logAction(merchant_id, 'bid_negotiating', {
      bid_id: bid.id, commodity: commodity.name, offered_price: offered_price_per_unit,
      price_range: `${commodity.min_price_per_unit}–${commodity.max_price_per_unit}`,
    }, `Negotiation started for ${commodity.name}. Buyer offered ₹${offered_price_per_unit}, min is ₹${commodity.min_price_per_unit}.`);

    return { bid: await BidModel.getById(bid.id), status: 'negotiating', session };
  }

  /**
   * Handle a buyer message in an active negotiation session.
   * Two-phase accept: first the agent confirms the deal and asks for payment preference,
   * then the buyer replies with their choice and we finalize + post payment link in chat.
   * Requirements: 3.2, 3.3, 3.4, 9.2
   */
  async handleNegotiationMessage(sessionId, buyerMessage) {
    const session = await NegotiationModel.getSessionById(sessionId);
    if (!session) throw new Error('Negotiation session not found');
    if (session.status !== 'active') throw new Error(`Session is ${session.status}, not active`);

    // Store buyer message
    await NegotiationModel.addMessage({ session_id: sessionId, sender: 'buyer', content: buyerMessage });

    const context = JSON.parse(session.context_json || '{}');

    // --- Phase 2: buyer is replying with payment choice after acceptance ---
    if (context.pendingAcceptance) {
      return this._handlePaymentChoice(sessionId, session, buyerMessage, context);
    }

    // --- Phase 1: normal negotiation ---
    const buyerHistory = await this.getBuyerHistory(session.buyer_id);
    context.buyerHistory = buyerHistory;

    const messages = await NegotiationModel.getMessages(sessionId);
    const conversationHistory = messages.map(m => ({ role: m.sender, content: m.content }));

    const response = await bedrockService.chat(session.system_prompt, conversationHistory, context);

    // Robust JSON extraction — Claude may wrap in markdown fences or add extra text
    const parsed = this._extractJSON(response);
    const displayMessage = parsed.message || response;
    await NegotiationModel.addMessage({ session_id: sessionId, sender: 'agent', content: displayMessage });

    // Detect accept: check parsed decision first, then keyword fallback
    const isAccept = parsed.decision === 'accept' || this._detectAcceptFromText(displayMessage);

    if (isAccept) {
      const agreedPrice = parsed.agreedPrice || this._extractPriceFromText(displayMessage) || context.offeredPrice;
      const creditEligible = await this.checkCreditEligibility(session.buyer_id);

      // Save pending acceptance in session context
      context.pendingAcceptance = { agreedPrice };
      await NegotiationModel.updateSessionContext(sessionId, context);

      // Ask buyer for payment preference
      let paymentChoiceMsg;
      if (creditEligible) {
        paymentChoiceMsg = `Great, the deal is confirmed at ₹${agreedPrice.toLocaleString('en-IN')} per unit! 🎉\n\nHow would you like to pay?\n\n1️⃣ **Credit Line** — 30-day payment term, pay later\n2️⃣ **Direct Payment** — Pay now via Pine Labs payment link\n\nPlease reply with "credit" or "direct" to proceed.`;
      } else {
        paymentChoiceMsg = `Great, the deal is confirmed at ₹${agreedPrice.toLocaleString('en-IN')} per unit! 🎉\n\nI'll generate a Pine Labs payment link for you. Please reply "confirm" to proceed with payment.`;
        // Not credit eligible — still save so we know to finalize on next message
        context.pendingAcceptance.forceDirect = true;
        await NegotiationModel.updateSessionContext(sessionId, context);
      }

      await NegotiationModel.addMessage({ session_id: sessionId, sender: 'agent', content: paymentChoiceMsg });
      return { message: paymentChoiceMsg, decision: 'payment_choice', creditEligible };
    }

    return { message: displayMessage, decision: parsed.decision || 'continue' };
  }

  /**
   * Handle buyer's payment method choice after deal acceptance.
   * Finalizes the transaction and posts the payment link in chat.
   */
  async _handlePaymentChoice(sessionId, session, buyerMessage, context) {
    const { agreedPrice, forceDirect } = context.pendingAcceptance;
    const lower = buyerMessage.toLowerCase().trim();

    let paymentMethod;
    if (forceDirect || lower.includes('direct') || lower.includes('payment link') || lower.includes('pay now') || lower.includes('confirm')) {
      paymentMethod = 'payment_link';
    } else if (lower.includes('credit') || lower.includes('later') || lower.includes('30') || lower.includes('1')) {
      paymentMethod = 'credit_line';
    } else {
      // Didn't understand — ask again
      const retryMsg = `I didn't catch that. Please reply:\n• "credit" for 30-day credit line\n• "direct" for Pine Labs payment link`;
      await NegotiationModel.addMessage({ session_id: sessionId, sender: 'agent', content: retryMsg });
      return { message: retryMsg, decision: 'payment_choice' };
    }

    // Clear pending state and finalize
    delete context.pendingAcceptance;
    await NegotiationModel.updateSessionContext(sessionId, context);

    const result = await this.finalizeTransaction(sessionId, agreedPrice, paymentMethod);

    // Build confirmation message with payment link in chat
    const bid = await BidModel.getById(session.bid_id);
    const totalAmount = agreedPrice * bid.requested_quantity;
    let confirmMsg;

    if (result.flagged) {
      confirmMsg = `⚠️ This order of ₹${totalAmount.toLocaleString('en-IN')} requires merchant approval. You'll be notified once it's reviewed. Thank you for your patience!`;
    } else if (paymentMethod === 'credit_line') {
      const clLink = result.creditLine?.payment_link || '';
      confirmMsg = `✅ Order confirmed! You've been approved for a 30-day credit line.\n\n📦 Total: ₹${totalAmount.toLocaleString('en-IN')}\n📅 Due Date: ${result.transaction.due_date}\n📅 Shipping: ${result.transaction.shipping_date}\n\n💳 When ready to pay: ${clLink}\n\nThank you for your business! 🙏`;
    } else {
      const plLink = result.paymentLink || '';
      confirmMsg = `✅ Order confirmed!\n\n📦 Total: ₹${totalAmount.toLocaleString('en-IN')}\n📅 Shipping: ${result.transaction.shipping_date}\n\n💳 Pay here: ${plLink}\n\nPayment link is valid for 3 days. Thank you! 🙏`;
    }

    await NegotiationModel.addMessage({ session_id: sessionId, sender: 'agent', content: confirmMsg });
    return { message: confirmMsg, decision: 'accept', transaction: result };
  }

  /**
   * Extract JSON from a response that may contain markdown fences or surrounding text.
   */
  _extractJSON(text) {
    if (!text) return {};
    // Try direct parse first
    try { return JSON.parse(text); } catch { /* continue */ }
    // Strip markdown code fences
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
    }
    // Find first { ... } block in the text
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try { return JSON.parse(braceMatch[0]); } catch { /* continue */ }
    }
    return {};
  }

  /**
   * Keyword-based fallback to detect acceptance from message text.
   */
  _detectAcceptFromText(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    const acceptPhrases = [
      'order confirmed', 'deal accepted', 'happy to confirm',
      'pleased to confirm', 'order is confirmed', 'deal is done',
      'transaction confirmed', 'accept your offer', 'accepted your offer',
      'confirm your order', 'order total:', 'estimated shipping',
      'payment link', 'credit line for this order',
    ];
    // Need at least 2 matching phrases to be confident it's an acceptance
    const matches = acceptPhrases.filter(p => lower.includes(p));
    return matches.length >= 2;
  }

  /**
   * Try to extract an agreed price from acceptance message text.
   */
  _extractPriceFromText(text) {
    if (!text) return null;
    // Look for "at ₹XXX per" pattern
    const match = text.match(/at\s*₹?\s*([\d,]+(?:\.\d+)?)\s*per/i);
    if (match) return parseFloat(match[1].replace(/,/g, ''));
    return null;
  }

  /**
   * Get buyer transaction history and metrics.
   * Requirements: 9.2
   */
  async getBuyerHistory(buyerId) {
    const transactions = await TransactionRecordModel.getByBuyerId(buyerId);
    const creditLines = await CreditLineModel.getByBuyerId(buyerId);

    const total_transaction_count = transactions.length;
    const total_transaction_value = transactions.reduce((sum, t) => sum + t.total_amount, 0);

    const paidTxns = transactions.filter(t => t.payment_status === 'paid' && t.completed_at && t.due_date);
    let average_payment_time = 0;
    let on_time_payment_percentage = 0;

    if (paidTxns.length > 0) {
      const paymentTimes = paidTxns.map(t => {
        const completed = new Date(t.completed_at);
        const due = new Date(t.due_date);
        return Math.max(0, Math.round((completed - due) / (1000 * 60 * 60 * 24)));
      });
      average_payment_time = paymentTimes.reduce((a, b) => a + b, 0) / paymentTimes.length;
      const onTime = paidTxns.filter(t => new Date(t.completed_at) <= new Date(t.due_date)).length;
      on_time_payment_percentage = Math.round((onTime / paidTxns.length) * 100);
    }

    const active_credit_lines = creditLines.filter(c => c.status === 'active').length;

    return {
      total_transaction_count,
      total_transaction_value,
      average_payment_time,
      on_time_payment_percentage,
      active_credit_lines,
    };
  }

  /**
   * Finalize a transaction: create record, decrement inventory, handle payment.
   * Requirements: 4.1–4.7, 1.3, 9.3, 9.4
   */
  async finalizeTransaction(sessionId, agreedPrice, paymentMethodOverride) {
    const session = await NegotiationModel.getSessionById(sessionId);
    if (!session) throw new Error('Session not found');

    const bid = await BidModel.getById(session.bid_id);
    const commodity = await CommodityModel.getById(bid.commodity_id);
    const totalAmount = agreedPrice * bid.requested_quantity;

    // Get auto-approval threshold from policy rules
    const thresholdRule = await db('policy_rules')
      .where({ merchant_id: bid.merchant_id, condition_type: 'auto_approval_threshold', is_active: 1 })
      .first();
    const threshold = thresholdRule ? parseFloat(thresholdRule.condition_value) : DEFAULT_AUTO_APPROVAL_THRESHOLD;

    // Determine payment method
    let paymentMethod = paymentMethodOverride;
    if (!paymentMethod) {
      if (totalAmount >= threshold) {
        // Flag for merchant review — don't auto-approve
        await BidModel.updateStatus(bid.id, 'submitted'); // back to submitted for review
        await this._logAction(bid.merchant_id, 'transaction_flagged', {
          bid_id: bid.id, total_amount: totalAmount, threshold,
        }, `Transaction ₹${totalAmount} exceeds auto-approval threshold ₹${threshold}. Flagged for merchant review.`);
        await NegotiationModel.updateSessionStatus(sessionId, 'completed');
        return { flagged: true, total_amount: totalAmount, threshold };
      }

      const eligible = await this.checkCreditEligibility(bid.buyer_id);
      paymentMethod = eligible ? 'credit_line' : 'payment_link';
    }

    // Decrement inventory
    await CommodityModel.decrementQuantity(commodity.id, bid.requested_quantity);

    // Create payment link if needed
    let paymentLink = null;
    if (paymentMethod === 'payment_link') {
      const plResult = await pinelabsService.createPaymentLink(bid.id, totalAmount);
      paymentLink = plResult.paymentLink;
    }

    // Shipping date: 7 days from now
    const shippingDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    // Due date: 30 days from now for credit, immediate for payment link
    const dueDate = paymentMethod === 'credit_line'
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const txRecord = await TransactionRecordModel.create({
      bid_id: bid.id, buyer_id: bid.buyer_id, commodity_id: bid.commodity_id,
      merchant_id: bid.merchant_id, quantity: bid.requested_quantity,
      agreed_price_per_unit: agreedPrice, total_amount: totalAmount,
      payment_method: paymentMethod, payment_link: paymentLink,
      shipping_date: shippingDate, due_date: dueDate,
    });

    // Create credit line if applicable
    let creditLine = null;
    if (paymentMethod === 'credit_line') {
      const clPaymentLink = await pinelabsService.createPaymentLink(`CL-${txRecord.id}`, totalAmount);
      creditLine = await CreditLineModel.create({
        transaction_record_id: txRecord.id, buyer_id: bid.buyer_id,
        merchant_id: bid.merchant_id, amount: totalAmount,
        due_date: dueDate, payment_link: clPaymentLink.paymentLink,
      });
    }

    // Record in treasury
    await db('transactions').insert({
      merchant_id: bid.merchant_id, type: 'incoming', amount: totalAmount,
      reference_type: 'bid_transaction', reference_id: txRecord.id,
      created_at: new Date().toISOString(),
    });

    // Update bid and session status
    await BidModel.updateStatus(bid.id, 'approved');
    await NegotiationModel.updateSessionStatus(sessionId, 'completed');

    // Log the decision
    const buyerHistory = await this.getBuyerHistory(bid.buyer_id);
    await this._logAction(bid.merchant_id, 'transaction_approved', {
      bid_id: bid.id, transaction_id: txRecord.id, total_amount: totalAmount,
      payment_method: paymentMethod, buyer_history: buyerHistory,
    }, `Transaction approved: ₹${totalAmount} via ${paymentMethod}. Buyer has ${buyerHistory.total_transaction_count} prior transactions.`);

    return { transaction: txRecord, creditLine, paymentLink, flagged: false };
  }

  /**
   * Check if a buyer is eligible for credit line.
   * New buyers (0 transactions) → no credit. Strong history → eligible.
   * Requirements: 9.3, 9.4
   */
  async checkCreditEligibility(buyerId) {
    const history = await this.getBuyerHistory(buyerId);
    if (history.total_transaction_count === 0) return false;
    return history.on_time_payment_percentage > 80 && history.total_transaction_count >= 3;
  }

  /**
   * Expire stale negotiation sessions (no activity for 24h).
   * Requirements: 3.6
   */
  async expireStaleNegotiations() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const staleSessions = await NegotiationModel.getStaleActiveSessions(cutoff);
    const results = [];

    for (const session of staleSessions) {
      await NegotiationModel.updateSessionStatus(session.id, 'expired');
      await BidModel.updateStatus(session.bid_id, 'expired');
      await this._logAction(session.merchant_id, 'negotiation_expired', {
        session_id: session.id, bid_id: session.bid_id,
      }, `Negotiation session ${session.id} expired due to 24h inactivity.`);
      results.push(session.id);
    }

    return results;
  }

  /**
   * Merchant manual approval for flagged bids.
   */
  async merchantApprove(bidId, paymentMethod) {
    const bid = await BidModel.getById(bidId);
    if (!bid) throw new Error('Bid not found');

    const session = await NegotiationModel.getSessionByBidId(bidId);
    if (!session) throw new Error('No negotiation session found for this bid');

    // Parse the last agreed price from session context
    const context = JSON.parse(session.context_json || '{}');
    const agreedPrice = context.offeredPrice || bid.offered_price_per_unit;

    return this.finalizeTransaction(session.id, agreedPrice, paymentMethod || 'payment_link');
  }

  async _logAction(merchantId, decisionType, inputs, reasoning) {
    await db('action_logs').insert({
      merchant_id: merchantId,
      agent_type: 'bidding',
      decision_type: decisionType,
      inputs: JSON.stringify(inputs),
      policy_rules_applied: null,
      outcome: decisionType,
      reasoning,
      created_at: new Date().toISOString(),
    });
  }
}

const biddingAgent = new BiddingAgent();
export default biddingAgent;
export { BiddingAgent };
