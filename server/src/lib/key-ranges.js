/**
 * Sort-key ranges that cover every key except those starting with one of
 * `prefixes`: below the first prefix, between each pair, above the last.
 * db-dynamodb.js turns each into one Query, so the excluded records are never
 * read or billed.
 *
 * Each range is `{ from?, to?, toInclusive? }`: `from` is inclusive; `to` is
 * exclusive unless `toInclusive` (DynamoDB's BETWEEN is inclusive, so a key
 * equal to the next prefix can come back and callers filter it).
 */
export function rangesExcluding(prefixes) {
  const list = [...new Set([].concat(prefixes))].sort();
  const after = (p) => p.slice(0, -1) + String.fromCharCode(p.charCodeAt(p.length - 1) + 1);
  const ranges = [{ to: list[0] }];
  for (let i = 0; i < list.length - 1; i++) ranges.push({ from: after(list[i]), to: list[i + 1], toInclusive: true });
  ranges.push({ from: after(list[list.length - 1]) });
  return { ranges, excluded: (key) => list.some((p) => key.startsWith(p)) };
}
