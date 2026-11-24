/**
 * An agent's prompt file begins with a header comment that names the agent
 * and says what it is for (client/prompts/*.md):
 *
 *   <!--
 *     AGENT: Lesson Owner
 *     PURPOSE: …
 *     RUNS: …
 *     READS: a; b
 *     RETURNS: a; b
 *   -->
 *
 * The header is part of the instructions sent to the model, so reading it
 * back from what was sent tells a Trace (#595) exactly which agent a call was
 * and what it was for at the time. It is also the one place an agent is
 * described: lib/agents.generated.js is built from these headers.
 *
 * Pure. Unit tests: client/tests/agentHeader.test.js.
 */
const FIELD = /^\s*([A-Z]+):\s*(.*)$/;

/** `{ name, purpose, runs, reads, returns }` from a prompt's text, or null if it has no header. */
export function parseAgentHeader(text) {
  const m = String(text ?? '').match(/^\s*<!--([\s\S]*?)-->/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split('\n')) {
    const f = line.match(FIELD);
    if (f) fields[f[1]] = f[2].trim();
  }
  if (!fields.AGENT) return null;
  const list = (v) => (v ? v.split(';').map((x) => x.trim()).filter(Boolean) : []);
  return {
    name: fields.AGENT,
    purpose: fields.PURPOSE || '',
    runs: fields.RUNS || '',
    reads: list(fields.READS),
    returns: list(fields.RETURNS),
  };
}
