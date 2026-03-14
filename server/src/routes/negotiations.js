import { Router } from 'express';
import * as NegotiationModel from '../models/negotiation.js';
import biddingAgent from '../agents/biddingAgent.js';

const router = Router();

// GET /:id — get negotiation session with messages
router.get('/:id', async (req, res) => {
  try {
    const session = await NegotiationModel.getSessionWithMessages(req.params.id);
    if (!session) return res.error('Negotiation session not found', 404);
    res.success(session);
  } catch (err) {
    res.error(err.message, 500);
  }
});

// POST /:id/messages — send message in negotiation
router.post('/:id/messages', async (req, res) => {
  try {
    const buyerMessage = req.body.message || req.body.content;
    if (!buyerMessage) return res.error('Required: message or content', 400);
    const result = await biddingAgent.handleNegotiationMessage(parseInt(req.params.id), buyerMessage);
    res.success(result);
  } catch (err) {
    const status = err.message.includes('not found') ? 404
      : err.message.includes('not active') ? 409 : 500;
    res.error(err.message, status);
  }
});

export default router;
