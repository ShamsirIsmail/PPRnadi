/**
 * Normalizes building code, building name, or spoken block reference into a canonical key.
 *
 * Examples:
 * - "BLK_A", "DR_BLK_A", "Blok A", "Block A", "A" -> "A"
 * - "BLK_B", "Blok B", "Block B", "B" -> "B"
 * - "BLK_12", "Blok 12", "12" -> "12"
 */
export function extractCanonicalBlockKey(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null;
  const clean = input.trim();
  if (!clean) return null;

  // 1. Standard prefixes with underscore, dash or space: DR_BLK_A, BLK_A, BLK-A, BLK A, BLOK A, BLOCK A
  const prefixMatch = clean.match(/^(?:(?:[A-Z0-9]+_)?(?:BLK|BLOK|BLOCK)(?:_|-|\s+)?)([A-Za-z0-9]+)$/i);
  if (prefixMatch) {
    return prefixMatch[1].toUpperCase();
  }

  // 2. Single isolated token like "A" or "12"
  const singleTokenMatch = clean.match(/^([A-Za-z0-9]+)$/);
  if (singleTokenMatch) {
    return singleTokenMatch[1].toUpperCase();
  }

  // 3. Embedded "Blok X" or "Block X" in phrase
  const embeddedMatch = clean.match(/\b(?:BLOK|BLOCK|BLK)(?:_|-|\s+)?([A-Za-z0-9]+)\b/i);
  if (embeddedMatch) {
    return embeddedMatch[1].toUpperCase();
  }

  return null;
}
