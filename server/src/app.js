import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateApiKey } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { responseHelper } from './middleware/responseHelper.js';
import invoiceRoutes from './routes/invoices.js';
import reminderRoutes from './routes/reminders.js';
import paymentPlanRoutes from './routes/paymentPlans.js';
import customerRoutes from './routes/customers.js';
import disputeRoutes from './routes/disputes.js';
import treasuryRoutes from './routes/treasury.js';
import threatRoutes from './routes/threats.js';
import dashboardRoutes from './routes/dashboard.js';
import policyRoutes from './routes/policies.js';
import webhookRoutes, { webhookPublicRouter } from './routes/webhooks.js';
import commodityRoutes from './routes/commodities.js';
import bidRoutes from './routes/bids.js';
import negotiationRoutes from './routes/negotiations.js';
import accountRoutes from './routes/accounts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// --- Global middleware ---
app.use(cors());
app.use(express.json());
app.use(responseHelper);

// --- Public routes (no auth) ---
app.get('/api/health', (req, res) => {
  res.success({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use('/api/v1/webhooks', webhookPublicRouter);

// --- Authenticated API routes ---
app.use('/api/v1', authenticateApiKey);

app.use('/api/v1/invoices', invoiceRoutes);
app.use('/api/v1/reminders', reminderRoutes);
app.use('/api/v1/payment-plans', paymentPlanRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/disputes', disputeRoutes);
app.use('/api/v1/treasury', treasuryRoutes);
app.use('/api/v1/threats', threatRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/policies', policyRoutes);
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/v1/commodities', commodityRoutes);
app.use('/api/v1/bids', bidRoutes);
app.use('/api/v1/negotiations', negotiationRoutes);
app.use('/api/v1/accounts', accountRoutes);

// --- Error handling ---
app.use(notFoundHandler);
app.use(errorHandler);

// --- Start server (only when run directly, not when imported for testing) ---
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  app.listen(PORT, () => {
    console.log(`Project Iris server running on port ${PORT}`);
  });
}

export default app;
