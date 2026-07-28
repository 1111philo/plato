/**
 * Prompt caching for the Anthropic Messages API.
 *
 * Every agent call ships the same large prefix: the bundled prompt
 * (client/prompts/*.md) plus the Program Knowledge Base and Lesson Catalog that
 * orchestrator.js appends at runtime. That prefix is identical across turns of a
 * lesson, so marking it `cache_control: ephemeral` moves it from full-price
 * input to cache reads (~0.1x) for the 5-minute TTL.
 *
 * Two constraints shape this:
 *
 * 1. There is a MINIMUM cacheable prefix — 4096 tokens on Haiku 4.5. Below it,
 *    Bedrock silently ignores `cache_control` (no error, usage reports zero
 *    cache tokens), so a short system prompt gains nothing. We only tag blocks
 *    comfortably above the minimum to avoid paying the 1.25x cache-write
 *    premium on a prefix that will never produce a read.
 *
 * 2. `cache_control` is an Anthropic Messages API field. Non-Anthropic Bedrock
 *    models (served through Converse) reject or ignore it, so it is only
 *    applied to Claude model ids.
 */

// Minimum cacheable prefix, in tokens, for the models plato runs. Haiku 4.5 is
// the highest of the family (the per-model minimums are not monotonic), so
// using it as the floor is safe for any Claude model we route to.
export const MIN_CACHEABLE_TOKENS = 4096;

// Conservative chars-per-token estimate for English prose. Real prompts measure
// ~4.27 (coach.md: 15,727 chars -> 3,685 tokens), so dividing by 4 slightly
// OVER-estimates the token count. That errs toward skipping a marginal prompt
// rather than paying a cache-write premium that never earns a read back.
const CHARS_PER_TOKEN = 4;

const MIN_CACHEABLE_CHARS = MIN_CACHEABLE_TOKENS * CHARS_PER_TOKEN;

/** Anthropic models accept `cache_control`; other Bedrock models do not. */
function supportsPromptCache(model) {
  return typeof model === 'string' && model.includes('claude');
}

/**
 * Convert a plain-string `system` prompt into a cache-marked content block when
 * it is long enough to be worth caching.
 *
 * Returns the system value to send: either the original (unchanged) or a
 * single-element block array carrying `cache_control`. An array `system` is
 * passed through untouched — callers that build their own blocks own their
 * cache placement.
 */
export function withCachedSystem(system, model) {
  if (typeof system !== 'string') return system;
  if (!supportsPromptCache(model)) return system;
  if (system.length < MIN_CACHEABLE_CHARS) return system;

  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
}
