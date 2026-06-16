const DAYS_FRESH = 30;
const DAYS_RECENT = 90;

/** Age in days since a given Date relative to now. */
export function ageInDays(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

/**
 * Three-tier freshness label based on file modification time.
 * - fresh:  < 30 days old
 * - recent: 30–90 days old
 * - stale:  > 90 days old
 */
export function freshnessLabel(date: Date): "fresh" | "recent" | "stale" {
  const age = ageInDays(date);
  if (age < DAYS_FRESH) return "fresh";
  if (age < DAYS_RECENT) return "recent";
  return "stale";
}
