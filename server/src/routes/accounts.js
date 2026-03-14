import { Router } from 'express';
import { getBuyerAccountSummary, getBuyerTransactionHistory, listBuyerAccounts } from '../models/account.js';

const router = Router();

// GET / — list buyer accounts with status
router.get('/', async (req, res) => {
  try {
    const merchantId = req.query.merchant_id || 1;
    const accounts = await listBuyerAccounts(merchantId);
    res.success(accounts);
  } catch (err) {
    res.error(err.message, 500);
  }
});

// GET /:buyerId — detailed buyer account page
router.get('/:buyerId', async (req, res) => {
  try {
    const summary = await getBuyerAccountSummary(parseInt(req.params.buyerId));
    res.success(summary);
  } catch (err) {
    res.error(err.message, 500);
  }
});

// GET /:buyerId/transactions — buyer transaction history
router.get('/:buyerId/transactions', async (req, res) => {
  try {
    const history = await getBuyerTransactionHistory(parseInt(req.params.buyerId));
    res.success(history);
  } catch (err) {
    res.error(err.message, 500);
  }
});

export default router;
