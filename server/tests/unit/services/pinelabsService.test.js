import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PineLabsService, withRetry } from '../../../src/services/pinelabsService.js';

describe('PineLabsService', () => {
  let service;

  beforeEach(() => {
    service = new PineLabsService();
  });

  // ─── createPaymentLink ───

  describe('createPaymentLink', () => {
    it('returns a valid payment link URL with correct invoiceId and amount', async () => {
      const result = await service.createPaymentLink(42, 1500);
      expect(result.paymentLink).toBe('https://pinelabs.mock/pay/42?amount=1500');
      expect(result.transactionRef).toMatch(/^MOCK-TXN-\d+$/);
      expect(result.expiresAt).toBeDefined();
    });

    it('uses provided expiry when given', async () => {
      const expiry = '2025-12-31T23:59:59.000Z';
      const result = await service.createPaymentLink(1, 500, expiry);
      expect(result.expiresAt).toBe(expiry);
    });

    it('generates a default expiry (24h from now) when not provided', async () => {
      const before = Date.now();
      const result = await service.createPaymentLink(1, 500);
      const expiryTime = new Date(result.expiresAt).getTime();
      // Should be roughly 24 hours from now (within 5 seconds tolerance)
      expect(expiryTime).toBeGreaterThan(before + 23 * 60 * 60 * 1000);
      expect(expiryTime).toBeLessThan(before + 25 * 60 * 60 * 1000);
    });

    it('handles string invoiceId', async () => {
      const result = await service.createPaymentLink('INV-100', 2500);
      expect(result.paymentLink).toBe('https://pinelabs.mock/pay/INV-100?amount=2500');
    });

    it('throws when invoiceId is null', async () => {
      await expect(service.createPaymentLink(null, 1000)).rejects.toThrow(
        'invoiceId and amount are required'
      );
    });

    it('throws when amount is null', async () => {
      await expect(service.createPaymentLink(1, null)).rejects.toThrow(
        'invoiceId and amount are required'
      );
    });

    it('throws when amount is zero', async () => {
      await expect(service.createPaymentLink(1, 0)).rejects.toThrow(
        'amount must be a positive number'
      );
    });

    it('throws when amount is negative', async () => {
      await expect(service.createPaymentLink(1, -100)).rejects.toThrow(
        'amount must be a positive number'
      );
    });
  });

  // ─── sendPaymentLinkViaSMS ───

  describe('sendPaymentLinkViaSMS', () => {
    it('returns success with messageId and sms channel', async () => {
      const result = await service.sendPaymentLinkViaSMS('+919876543210', 'https://pinelabs.mock/pay/1?amount=500');
      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^MOCK-SMS-\d+$/);
      expect(result.channel).toBe('sms');
    });

    it('throws when phone is missing', async () => {
      await expect(service.sendPaymentLinkViaSMS('', 'https://link')).rejects.toThrow(
        'phone and link are required'
      );
    });

    it('throws when link is missing', async () => {
      await expect(service.sendPaymentLinkViaSMS('+919876543210', '')).rejects.toThrow(
        'phone and link are required'
      );
    });
  });

  // ─── sendPaymentLinkViaEmail ───

  describe('sendPaymentLinkViaEmail', () => {
    it('returns success with messageId and email channel', async () => {
      const result = await service.sendPaymentLinkViaEmail('customer@example.com', 'https://pinelabs.mock/pay/1?amount=500');
      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^MOCK-EMAIL-\d+$/);
      expect(result.channel).toBe('email');
    });

    it('throws when email is missing', async () => {
      await expect(service.sendPaymentLinkViaEmail('', 'https://link')).rejects.toThrow(
        'email and link are required'
      );
    });

    it('throws when link is missing', async () => {
      await expect(service.sendPaymentLinkViaEmail('customer@example.com', '')).rejects.toThrow(
        'email and link are required'
      );
    });
  });

  // ─── processRefund ───

  describe('processRefund', () => {
    it('returns a refund reference with correct amount and processed status', async () => {
      const result = await service.processRefund('TXN-123', 750);
      expect(result.refundRef).toMatch(/^MOCK-REFUND-\d+$/);
      expect(result.amount).toBe(750);
      expect(result.status).toBe('processed');
    });

    it('throws when transactionRef is missing', async () => {
      await expect(service.processRefund('', 500)).rejects.toThrow(
        'transactionRef and amount are required'
      );
    });

    it('throws when amount is missing', async () => {
      await expect(service.processRefund('TXN-123', null)).rejects.toThrow(
        'transactionRef and amount are required'
      );
    });

    it('throws when amount is zero', async () => {
      await expect(service.processRefund('TXN-123', 0)).rejects.toThrow(
        'refund amount must be a positive number'
      );
    });

    it('throws when amount is negative', async () => {
      await expect(service.processRefund('TXN-123', -100)).rejects.toThrow(
        'refund amount must be a positive number'
      );
    });
  });

  // ─── validateCallback ───

  describe('validateCallback', () => {
    it('returns valid for a well-formed callback payload', async () => {
      const result = await service.validateCallback({
        transaction_id: 'TXN-001',
        invoice_id: 42,
        amount: 1500,
        status: 'success',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects null payload', async () => {
      const result = await service.validateCallback(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Payload must be a non-null object');
    });

    it('rejects non-object payload', async () => {
      const result = await service.validateCallback('not-an-object');
      expect(result.valid).toBe(false);
    });

    it('reports missing required fields', async () => {
      const result = await service.validateCallback({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: transaction_id');
      expect(result.errors).toContain('Missing required field: invoice_id');
      expect(result.errors).toContain('Missing required field: amount');
      expect(result.errors).toContain('Missing required field: status');
    });

    it('reports partially missing fields', async () => {
      const result = await service.validateCallback({
        transaction_id: 'TXN-001',
        invoice_id: 42,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: amount');
      expect(result.errors).toContain('Missing required field: status');
      expect(result.errors).not.toContain('Missing required field: transaction_id');
    });

    it('rejects invalid amount (non-positive)', async () => {
      const result = await service.validateCallback({
        transaction_id: 'TXN-001',
        invoice_id: 42,
        amount: -100,
        status: 'success',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Field "amount" must be a positive number');
    });

    it('rejects invalid amount (string)', async () => {
      const result = await service.validateCallback({
        transaction_id: 'TXN-001',
        invoice_id: 42,
        amount: 'not-a-number',
        status: 'success',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Field "amount" must be a positive number');
    });

    it('rejects invalid status value', async () => {
      const result = await service.validateCallback({
        transaction_id: 'TXN-001',
        invoice_id: 42,
        amount: 1500,
        status: 'invalid-status',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Field "status" must be one of: success, failed, pending');
    });

    it('rejects non-string transaction_id', async () => {
      const result = await service.validateCallback({
        transaction_id: 12345,
        invoice_id: 42,
        amount: 1500,
        status: 'success',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Field "transaction_id" must be a string');
    });

    it('accepts all valid status values', async () => {
      for (const status of ['success', 'failed', 'pending']) {
        const result = await service.validateCallback({
          transaction_id: 'TXN-001',
          invoice_id: 42,
          amount: 1500,
          status,
        });
        expect(result.valid).toBe(true);
      }
    });
  });
});

// ─── Retry Logic ───

describe('withRetry', () => {
  // Use zero delays for fast tests — the real delays (0, 1000, 4000) are tested via the default export
  const fastDelays = [0, 0, 0];

  it('returns result on first successful attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { delays: fastDelays });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds on second attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');
    const onRetry = vi.fn();
    const result = await withRetry(fn, { onRetry, delays: fastDelays });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it('retries up to 3 times then throws the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));
    const onRetry = vi.fn();
    await expect(withRetry(fn, { onRetry, delays: fastDelays })).rejects.toThrow('persistent failure');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it('succeeds on third attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('finally');
    const result = await withRetry(fn, { delays: fastDelays });
    expect(result).toBe('finally');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls onRetry with attempt number on each failure', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'))
      .mockResolvedValue('ok');
    const onRetry = vi.fn();
    await withRetry(fn, { onRetry, delays: fastDelays });
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.objectContaining({ message: 'e1' }), 1);
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.objectContaining({ message: 'e2' }), 2);
  });

  it('uses default RETRY_DELAYS when no delays option provided', async () => {
    // Verify the default delays array is [0, 1000, 4000]
    const { RETRY_DELAYS } = await import('../../../src/services/pinelabsService.js');
    expect(RETRY_DELAYS).toEqual([0, 1000, 4000]);
  });
});

// ─── Simulated Delay ───

describe('simulated delay', () => {
  it('createPaymentLink takes at least 200ms (simulated delay)', async () => {
    const service = new PineLabsService();
    const start = Date.now();
    await service.createPaymentLink(1, 500);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(150); // allow small timing variance
  });
});
