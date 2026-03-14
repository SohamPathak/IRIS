import { Router } from 'express';
import * as BidModel from '../models/bid.js';
import * as NegotiationModel from '../models/negotiation.js';
import biddingAgent from '../agents/biddingAgent.js';

const router = Router();

// GET / — list bids
router.get('/', async (req, res) => {
  try {
    const filters = {};
    if (req.query.merchant_id) filters.merchant_id = req.query.merchant_id;
    else filters.merchant_id = 1;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.buyer_id) filters.buyer_id = req.query.buyer_id;
    const bids = await BidModel.list(filters);
    res.success(bids);
  } catch (err) {
    res.error(err.message, 500);
  }
});

// GET /:id — bid detail with negotiation
router.get('/:id', async (req, res) => {
  try {
    const bid = await BidModel.getById(req.params.id);
    if (!bid) return res.error('Bid not found', 404);
    const session = await NegotiationModel.getSessionByBidId(bid.id);
    res.success({ ...bid, negotiation: session || null });
  } catch (err) {
    res.error(err.message, 500);
  }
});

// POST / — submit new bid (triggers Bidding Agent)
router.post('/', async (req, res) => {
  try {
    const { buyer_id, commodity_id, requested_quantity, offered_price_per_unit } = req.body;
    const merchantId = req.body.merchant_id || 1;
    if (!buyer_id || !commodity_id || !requested_quantity || !offered_price_per_unit) {
      return res.error('Required: buyer_id, commodity_id, requested_quantity, offered_price_per_unit', 400);
    }
    const result = await biddingAgent.processBid({
      buyer_id, commodity_id, merchant_id: merchantId,
      requested_quantity, offered_price_per_unit,
    });
    // If bid was rejected due to insufficient inventory, return a friendly error
    if (result.status === 'rejected' && result.reason === 'insufficient_inventory') {
      return res.error(
        `Not enough stock available. Only ${result.available_quantity} units in inventory, but you requested ${requested_quantity}.`,
        422
      );
    }
    res.success(result, 201);
  } catch (err) {
    res.error(err.message, err.message.includes('not found') ? 404 : 400);
  }
});

// PATCH /:id/approve — merchant manual approval
router.patch('/:id/approve', async (req, res) => {
  try {
    const paymentMethod = req.body.payment_method || 'payment_link';
    const result = await biddingAgent.merchantApprove(parseInt(req.params.id), paymentMethod);
    res.success(result);
  } catch (err) {
    res.error(err.message, err.message.includes('not found') ? 404 : 400);
  }
});

export default router;
