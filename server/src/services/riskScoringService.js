/**
 * Risk Scoring Service
 *
 * Computes customer risk scores based on payment history, overdue frequency,
 * and average days-to-pay. Categorizes scores into low/medium/high risk tiers.
 *
 * Formula:
 *   Base score: 50
 *   + Late payment penalty: +5 per late payment (capped at +30)
 *   + Avg days-to-pay penalty: +(avgDays - 30) * 0.5 if avgDays > 30
 *   + Overdue invoice penalty: +10 per active overdue invoice
 *   - On-time payment bonus: -5 per on-time payment (capped at -30)
 *   Final score clamped to [0, 100]
 *
 * Categories: 0–33 = low, 34–66 = medium, 67–100 = high
 *
 * Requirements: 5.4, 12.1
 */

class RiskScoringService {
  /**
   * Computes a risk score from 0–100 for a customer.
   *
   * @param {object} paymentHistory
   * @param {number} paymentHistory.latePaymentCount - Number of late payments
   * @param {number} paymentHistory.onTimePaymentCount - Number of on-time payments
   * @param {number} paymentHistory.overdueInvoiceCount - Number of currently active overdue invoices
   * @param {number} overdueFrequency - (unused, kept for interface compatibility)
   * @param {number} avgDaysToPay - Average number of days the customer takes to pay
   * @returns {number} Risk score clamped to [0, 100]
   */
  computeRiskScore(paymentHistory, overdueFrequency, avgDaysToPay) {
    const { latePaymentCount = 0, onTimePaymentCount = 0, overdueInvoiceCount = 0 } = paymentHistory || {};

    let score = 50;

    // Late payment penalty: +5 per late payment, capped at +30
    const latePenalty = Math.min(latePaymentCount * 5, 30);
    score += latePenalty;

    // Average days-to-pay penalty: +(avgDays - 30) * 0.5 if > 30 days
    if (avgDaysToPay > 30) {
      score += (avgDaysToPay - 30) * 0.5;
    }

    // Overdue invoice penalty: +10 per active overdue invoice
    score += overdueInvoiceCount * 10;

    // On-time payment bonus: -5 per on-time payment, capped at -30
    const onTimeBonus = Math.min(onTimePaymentCount * 5, 30);
    score -= onTimeBonus;

    // Clamp to [0, 100]
    return Math.max(0, Math.min(100, Math.round(score * 100) / 100));
  }

  /**
   * Categorizes a risk score into low, medium, or high.
   *
   * @param {number} score - Risk score (0–100)
   * @returns {'low' | 'medium' | 'high'}
   */
  categorizeRisk(score) {
    if (score <= 33) return 'low';
    if (score <= 66) return 'medium';
    return 'high';
  }
}

// Export singleton instance and class for testing
const riskScoringService = new RiskScoringService();
export default riskScoringService;
export { RiskScoringService };
