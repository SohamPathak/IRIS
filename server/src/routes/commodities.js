import { Router } from 'express';
import * as CommodityModel from '../models/commodity.js';

const router = Router();

// GET / — list commodities
router.get('/', async (req, res) => {
  try {
    const merchantId = req.query.merchant_id || 1;
    const commodities = await CommodityModel.list({ merchant_id: merchantId });
    res.success(commodities);
  } catch (err) {
    res.error(err.message, 500);
  }
});

// GET /:id — commodity detail
router.get('/:id', async (req, res) => {
  try {
    const commodity = await CommodityModel.getById(req.params.id);
    if (!commodity) return res.error('Commodity not found', 404);
    res.success(commodity);
  } catch (err) {
    res.error(err.message, 500);
  }
});

// POST / — create commodity
router.post('/', async (req, res) => {
  try {
    const { name, description, unit, available_quantity, min_price_per_unit, max_price_per_unit } = req.body;
    const merchantId = req.body.merchant_id || 1;
    if (!name || !unit || min_price_per_unit == null || max_price_per_unit == null) {
      return res.error('Required: name, unit, min_price_per_unit, max_price_per_unit', 400);
    }
    const commodity = await CommodityModel.create({
      merchant_id: merchantId, name, description, unit,
      available_quantity: available_quantity || 0, min_price_per_unit, max_price_per_unit,
    });
    res.success(commodity, 201);
  } catch (err) {
    res.error(err.message, 400);
  }
});

// PUT /:id — update commodity
router.put('/:id', async (req, res) => {
  try {
    const commodity = await CommodityModel.update(req.params.id, req.body);
    res.success(commodity);
  } catch (err) {
    res.error(err.message, err.message.includes('not found') ? 404 : 400);
  }
});

export default router;
