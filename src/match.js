// Name normalisation and match classification.

const LEGAL_SUFFIXES = new Set([
  'pty', 'proprietary', 'ltd', 'limited', 'inc', 'incorporated', 'llc', 'llp', 'lp',
  'plc', 'corp', 'corporation', 'co', 'company',
]);

/** Lower-case, strip accents, turn & into "and", drop punctuation. */
export function normalise(input) {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Normalise, then drop a leading "the", "and" and trailing legal-form words (Pty Ltd, Inc, LLC...). */
export function nameKey(input) {
  let tokens = normalise(input).split(' ').filter(Boolean);
  if (tokens[0] === 'the' && tokens.length > 1) tokens = tokens.slice(1);
  // "and" (from "&") carries no identity: "Heat & Chill" and "& Chill Ltd" must not look alike because of it.
  const withoutAnd = tokens.filter((t) => t !== 'and');
  if (withoutAnd.length) tokens = withoutAnd;
  // At most two trailing company-form words ("Pty Ltd"), so "Bank of Co" style names are not eaten.
  for (let i = 0; i < 2 && tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]); i++) tokens.pop();
  return tokens.join(' ');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

function containsTokens(haystack, needle) {
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Classify a register hit against the proposed name.
 *  exact   same name once case, punctuation, "&"/"and", spacing and legal suffixes are ignored
 *  close   one name contains the other as whole words, or a near-identical spelling
 *  related anything else the register returned
 */
export function classify(query, candidate) {
  const q = nameKey(query);
  const c = nameKey(candidate);
  if (!q || !c) return 'related';
  if (q === c || q.replace(/ /g, '') === c.replace(/ /g, '')) return 'exact';
  if (containsTokens(c, q)) return 'close';
  // A short candidate inside a longer query (HEAT in "heat and chill") only counts if it is most of the query.
  if (c.length >= 4 && c.length >= q.length * 0.6 && containsTokens(q, c)) return 'close';
  const qj = q.replace(/ /g, '');
  const cj = c.replace(/ /g, '');
  // One letter off counts as close for names of 4+ letters (Bolt / Volt), otherwise a similarity cut-off.
  if (qj.length >= 4 && cj.length >= 4 && levenshtein(qj, cj) <= 1) return 'close';
  if (similarity(qj, cj) >= 0.8) return 'close';
  const qt = q.split(' ');
  const ct = new Set(c.split(' '));
  if (qt.length > 1 && qt.every((t) => ct.has(t))) return 'close';
  return 'related';
}

const RANK = { exact: 0, close: 1, related: 2 };

export function rankMatches(matches) {
  return [...matches].sort((a, b) => RANK[a.match] - RANK[b.match]);
}
