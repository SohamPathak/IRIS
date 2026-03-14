/**
 * Bedrock Service — Real AWS Bedrock + Mock Fallback
 *
 * Uses AWS Bedrock Runtime (Claude) when credentials are configured.
 * Falls back to mock negotiation logic when AWS_ACCESS_KEY_ID is not set.
 *
 * Requirements: 8.1, 8.3, 8.4, 8.5, 8.6
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const MOCK_DELAY_MS = 200;
const RETRY_DELAYS = [0, 1000, 4000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, { onRetry, delays = RETRY_DELAYS } = {}) {
  let lastError;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    try {
      if (delays[attempt] > 0) await sleep(delays[attempt]);
      return await fn();
    } catch (err) {
      lastError = err;
      if (onRetry) onRetry(err, attempt + 1);
    }
  }
  throw lastError;
}

async function simulateDelay() {
  await sleep(MOCK_DELAY_MS);
}

class BedrockService {
  constructor() {
    this._useLive = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
    this._client = null;
    this._modelId = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-3-5-haiku-20241022-v1:0';

    if (this._useLive) {
      const config = { region: process.env.AWS_DEFAULT_REGION || 'us-east-1' };
      if (process.env.AWS_SESSION_TOKEN) {
        config.credentials = {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          sessionToken: process.env.AWS_SESSION_TOKEN,
        };
      }
      this._client = new BedrockRuntimeClient(config);
      console.log(`🧠 Bedrock: LIVE mode (model: ${this._modelId})`);
    } else {
      console.log('🧠 Bedrock: MOCK mode (set AWS_ACCESS_KEY_ID to enable live)');
    }
  }

  /**
   * Agentic chat — returns AI-generated response string.
   * Uses real Bedrock when live, mock negotiation logic otherwise.
   */
  async chat(systemPrompt, conversationHistory, context = {}) {
    if (!systemPrompt || typeof systemPrompt !== 'string') {
      throw new Error('Bedrock API error: systemPrompt is required and must be a string');
    }
    if (!Array.isArray(conversationHistory)) {
      throw new Error('Bedrock API error: conversationHistory must be an array');
    }

    if (this._useLive) {
      return withRetry(async () => {
        return this._liveChat(systemPrompt, conversationHistory, context);
      });
    }

    return withRetry(async () => {
      await simulateDelay();
      return this._mockNegotiationResponse(conversationHistory, context);
    });
  }

  /**
   * Real Bedrock Claude call via InvokeModel.
   */
  async _liveChat(systemPrompt, conversationHistory, context) {
    // Build Claude messages format
    const messages = conversationHistory.map(m => ({
      role: m.role === 'buyer' ? 'user' : 'assistant',
      content: m.content,
    }));

    // Enhance system prompt with context and response format instructions
    const { priceRange, offeredPrice, commodity, buyerHistory, requestedQuantity } = context;
    let enhancedPrompt = systemPrompt;
    enhancedPrompt += `\n\nYou MUST respond with a valid JSON object (no markdown, no code fences) with this structure:
{
  "decision": "accept" | "counter" | "reject",
  "message": "Your natural language response to the buyer",
  "agreedPrice": <number, only when decision is accept>,
  "counterPrice": <number, only when decision is counter>
}

Rules:
- If the buyer's price >= minimum price, accept the deal.
- If the buyer's price is within 20% of minimum, counter with a price closer to minimum.
- If the buyer's price is below 80% of minimum, reject politely and suggest a starting price.
- Keep messages warm, professional, and include emojis. Mention order totals, shipping (7 days), and payment method.
- For trusted buyers (5+ transactions, >80% on-time), mention 30-day credit line option.
- For new/other buyers, mention Pine Labs payment link.`;

    if (buyerHistory) {
      enhancedPrompt += `\n\nBuyer history: ${buyerHistory.total_transaction_count} transactions, ${buyerHistory.on_time_payment_percentage}% on-time payments, ${buyerHistory.active_credit_lines} active credit lines.`;
    }

    const body = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1024,
      system: enhancedPrompt,
      messages,
    };

    const command = new InvokeModelCommand({
      modelId: this._modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    });

    const response = await this._client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const text = responseBody.content?.[0]?.text || '';

    // Claude should return JSON, but clean up just in case
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return cleaned;
  }

  /**
   * Artifact review — reviews dispute artifacts and returns structured assessment.
   */
  async reviewArtifacts(disputeDetails, artifactDescriptions = [], policyRules = []) {
    if (!disputeDetails || typeof disputeDetails !== 'object') {
      throw new Error('Bedrock API error: disputeDetails is required');
    }

    if (this._useLive) {
      return withRetry(async () => {
        return this._liveArtifactReview(disputeDetails, artifactDescriptions, policyRules);
      });
    }

    return withRetry(async () => {
      await simulateDelay();
      return this._mockArtifactReview(disputeDetails, artifactDescriptions, policyRules);
    });
  }

  /**
   * Real Bedrock call for artifact review.
   */
  async _liveArtifactReview(disputeDetails, artifacts, policyRules) {
    const systemPrompt = `You are a dispute resolution AI. Analyze the dispute and artifacts, then respond with a JSON object:
{
  "validity": true/false,
  "supportLevel": "strong" | "moderate" | "weak",
  "recommendedResolution": "full_refund" | "partial_refund" | "replacement" | "rejection",
  "policyAligned": true/false,
  "reasoning": "Brief explanation"
}
Policy rules: ${JSON.stringify(policyRules)}`;

    const messages = [{
      role: 'user',
      content: `Dispute: ${JSON.stringify(disputeDetails)}\nArtifacts: ${JSON.stringify(artifacts)}`,
    }];

    const body = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 512,
      system: systemPrompt,
      messages,
    };

    const command = new InvokeModelCommand({
      modelId: this._modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    });

    const response = await this._client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const text = responseBody.content?.[0]?.text || '{}';
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      return { validity: false, supportLevel: 'weak', recommendedResolution: 'rejection', policyAligned: true, reasoning: text };
    }
  }

  // --- Mock internals (used when AWS credentials not set) ---

  _mockNegotiationResponse(history, context) {
    const { priceRange, offeredPrice, commodity, buyerHistory, requestedQuantity } = context;
    const lastMsg = history.length > 0 ? history[history.length - 1] : null;
    const commodityName = commodity?.name || 'the commodity';
    const unit = commodity?.unit || 'units';
    const minPrice = priceRange?.min || 0;
    const maxPrice = priceRange?.max || Infinity;
    const qty = requestedQuantity || 0;
    const roundCount = history.filter(m => m.role === 'buyer').length;

    let price = offeredPrice;
    if (lastMsg && lastMsg.role === 'buyer') {
      const match = lastMsg.content.match(/₹?\s*(\d+(?:,\d+)*(?:\.\d+)?)/);
      if (match) price = parseFloat(match[1].replace(/,/g, ''));
    }

    const totalAmount = Math.round(price * qty * 100) / 100;
    const trustLevel = buyerHistory
      ? (buyerHistory.total_transaction_count >= 5 && buyerHistory.on_time_payment_percentage > 80 ? 'high'
        : buyerHistory.total_transaction_count >= 2 ? 'medium' : 'new')
      : 'new';

    if (price >= minPrice) {
      const paymentNote = trustLevel === 'high'
        ? `Since you're a valued buyer with ${buyerHistory?.total_transaction_count || 0} successful transactions and ${buyerHistory?.on_time_payment_percentage || 0}% on-time payments, I can offer you a 30-day credit line for this order.`
        : `I'll generate a Pine Labs payment link for ₹${totalAmount.toLocaleString('en-IN')} — valid for 3 days.`;

      return JSON.stringify({
        decision: 'accept',
        agreedPrice: price,
        message: `Excellent! I'm happy to confirm your order of ${qty} ${unit} of ${commodityName} at ₹${price.toLocaleString('en-IN')} per ${unit}.\n\n📦 Order Total: ₹${totalAmount.toLocaleString('en-IN')}\n📅 Estimated Shipping: 7 business days\n\n💳 ${paymentNote}\n\nThank you for your business!`,
      });
    }

    const threshold = minPrice * 0.8;

    if (price >= threshold) {
      const gap = minPrice - price;
      const counterPrice = roundCount >= 3
        ? minPrice
        : Math.round((price + gap * 0.6) * 100) / 100;
      const counterTotal = Math.round(counterPrice * qty * 100) / 100;

      const messages = [
        `Thank you for your offer of ₹${price.toLocaleString('en-IN')} per ${unit} for ${commodityName}. I understand you're looking for a competitive price.\n\nOur ${commodityName} is premium quality — sourced directly from our mills. Given current market rates and our quality standards, I can offer you ₹${counterPrice.toLocaleString('en-IN')} per ${unit}.\n\n📊 That brings your order total to ₹${counterTotal.toLocaleString('en-IN')} for ${qty} ${unit}.\n\nWould this work for you?`,
        `I appreciate you coming back with ₹${price.toLocaleString('en-IN')}. We're getting closer!\n\nLet me check what I can do... Considering the volume of ${qty} ${unit}, I can bring it down to ₹${counterPrice.toLocaleString('en-IN')} per ${unit}. That's ₹${counterTotal.toLocaleString('en-IN')} total.\n\n${trustLevel !== 'new' ? `As a returning buyer, I can also offer flexible payment terms.` : `For first-time orders, we offer secure Pine Labs payment links.`}\n\nShall we close at this price?`,
        `₹${price.toLocaleString('en-IN')} is very close to what I can work with. My best and final offer is ₹${counterPrice.toLocaleString('en-IN')} per ${unit} for ${commodityName}.\n\n💰 Total: ₹${counterTotal.toLocaleString('en-IN')}\n📦 Shipping: Within 7 days of payment\n\nThis is the lowest I can go. What do you say?`,
      ];

      return JSON.stringify({
        decision: 'counter',
        counterPrice,
        message: messages[Math.min(roundCount - 1, messages.length - 1)] || messages[0],
      });
    }

    const suggestedPrice = Math.round(minPrice * 0.95 * 100) / 100;
    return JSON.stringify({
      decision: 'reject',
      message: `I appreciate your interest in ${commodityName}, but ₹${price.toLocaleString('en-IN')} per ${unit} is significantly below our cost price.\n\nOur ${commodityName} is premium grade with quality certification. The market rate for this quality is ₹${minPrice.toLocaleString('en-IN')}–₹${maxPrice.toLocaleString('en-IN')} per ${unit}.\n\n🏷️ I could start a conversation at ₹${suggestedPrice.toLocaleString('en-IN')} per ${unit} if you're interested.\n\nWould you like to revise your offer?`,
    });
  }

  _mockArtifactReview(disputeDetails, artifacts, policyRules) {
    const claimLen = (disputeDetails.claim_details || '').length;
    const hasArtifacts = artifacts && artifacts.length > 0;

    let supportLevel, recommendedResolution, validity;

    if (claimLen > 50 && hasArtifacts) {
      supportLevel = 'strong';
      recommendedResolution = 'full_refund';
      validity = true;
    } else if (claimLen > 20) {
      supportLevel = 'moderate';
      recommendedResolution = 'partial_refund';
      validity = true;
    } else {
      supportLevel = 'weak';
      recommendedResolution = 'rejection';
      validity = false;
    }

    const refundThreshold = policyRules.find(r => r.condition_type === 'refund_threshold' && r.is_active);
    let policyAligned = true;
    if (refundThreshold && recommendedResolution !== 'rejection') {
      const threshold = parseFloat(refundThreshold.condition_value);
      if (disputeDetails.amount > threshold && recommendedResolution === 'full_refund') {
        policyAligned = false;
        recommendedResolution = 'partial_refund';
      }
    }

    return {
      validity,
      supportLevel,
      recommendedResolution,
      policyAligned,
      reasoning: `Claim analysis: ${claimLen} chars, ${artifacts.length} artifact(s). Support level: ${supportLevel}.`,
    };
  }
}

const bedrockService = new BedrockService();
export default bedrockService;
export { BedrockService, withRetry, sleep, MOCK_DELAY_MS, RETRY_DELAYS };
