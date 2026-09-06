/**
 * Thrown for any invalid querySeries input (bad metric string, bad bucket/agg,
 * unparseable date). Callers -- eventually the agent tool layer -- can catch
 * this specifically to turn it into a user-facing message instead of a 500.
 */
export class AnalyticsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyticsError';
  }
}
