// Addresses SES won't deliver to (server: lib/email-suppression.js). SES
// drops mail to them silently, so the admin UI says so instead of "sent".

export const SUPPRESSION_LABEL = { BOUNCE: 'Email bounced', COMPLAINT: 'Marked as spam' };

/** `{ suppressed: [...] }` → `{ [email]: { reason, since } }`. */
export function suppressionMap(res) {
  const map = {};
  for (const s of Array.isArray(res?.suppressed) ? res.suppressed : []) {
    if (s?.email) map[String(s.email).toLowerCase()] = { reason: s.reason, since: s.since || null };
  }
  return map;
}

const onDate = (since) => {
  const d = since ? new Date(since) : null;
  return d && !Number.isNaN(d.getTime())
    ? ` on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : '';
};

/** What happened, for one address: "bounced on Mar 22, 2026" / "marked our email as spam". */
export function suppressionReason(s) {
  return s?.reason === 'COMPLAINT' ? `marked our email as spam${onDate(s.since)}` : `bounced${onDate(s?.since)}`;
}

/** The banner when an email wasn't sent because the address is suppressed. */
export function notSentText(email, s) {
  return s?.reason === 'COMPLAINT'
    ? `Not sent: ${email} ${suppressionReason(s)}.`
    : `Not sent: ${email} ${suppressionReason(s)}. Check the address.`;
}
