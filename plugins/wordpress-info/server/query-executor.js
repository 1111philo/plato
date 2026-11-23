/**
 * Query executor for WordPress Info plugin.
 *
 * Fetches from three source types:
 * 1. wporg-docs — WordPress.org developer docs (REST API /wp/v2/search)
 * 2. make-blogs — Make WordPress blogs (REST API /wp/v2/posts)
 * 3. github-code — GitHub WordPress/WordPress repo (GitHub API code search)
 *
 * Fail-open: timeouts, fetch errors, and malformed responses return empty arrays.
 * SSRF defense: all URLs validated against ALLOWED_HOSTS before fetch.
 *
 * Trace mode (#595): given a recorder (`ctx.trace` on a traced lesson start),
 * every request goes through `trace.fetch`, which records its URL, status,
 * time and size. Without one, plain `fetch`, as before.
 */

import { ALLOWED_HOSTS } from './sources.js';

const TIMEOUT_MS = 8000;
const MAX_RESULTS_PER_SOURCE = 5;

/**
 * Strip HTML tags from text (multiple passes to handle nested/malformed tags).
 * Used to sanitize excerpts from external APIs before displaying to learners.
 */
function stripHtml(text) {
  if (!text) return '';
  let result = text;
  let prev = '';
  while (result !== prev && /<[^>]*>/.test(result)) {
    prev = result;
    result = result.replace(/<[^>]*>/g, '');
  }
  return result.trim();
}

/**
 * Validate that a URL's host is in the allowlist. Throws if not.
 */
function validateHost(url) {
  const parsed = new URL(url);
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    throw new Error(`Host ${parsed.hostname} not in allowlist`);
  }
}

/**
 * Fetch with timeout. Returns the Response or throws.
 */
async function fetchWithTimeout(url, options = {}, trace = null, purpose = '') {
  validateHost(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const init = { ...options, signal: controller.signal };
    const res = trace ? await trace.fetch(purpose, url, init) : await fetch(url, init);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** What a search is for, in a trace. */
function searchPurpose(source, query) {
  return `Search ${source.label || source.id} for “${query}”`;
}

/**
 * Query wporg-docs source (developer.wordpress.org REST API).
 * Endpoint: /wp/v2/search?search=<query>
 * Returns: [{ url, title, excerpt }]
 */
async function queryWporgDocs(source, query, trace) {
  try {
    const url = new URL(source.base);
    url.searchParams.set(source.searchParam || 'search', query);
    url.searchParams.set('per_page', String(MAX_RESULTS_PER_SOURCE));
    url.searchParams.set('_embed', '1');

    const res = await fetchWithTimeout(url.toString(), {}, trace, searchPurpose(source, query));
    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map(item => ({
      url: item.url || '',
      title: stripHtml(item.title || ''),
      excerpt: stripHtml(item._embedded?.self?.[0]?.excerpt || ''),
    })).filter(r => r.url && r.title);
  } catch {
    return []; // fail open
  }
}

/**
 * Query make-blogs source (make.wordpress.org REST API).
 * Endpoint: /wp/v2/posts?search=<query>
 * Returns: [{ url, title, excerpt }]
 */
async function queryMakeBlogs(source, query, trace) {
  try {
    const url = new URL(source.base);
    url.searchParams.set(source.searchParam || 'search', query);
    url.searchParams.set('per_page', String(MAX_RESULTS_PER_SOURCE));

    const res = await fetchWithTimeout(url.toString(), {}, trace, searchPurpose(source, query));
    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map(item => ({
      url: item.link || '',
      title: stripHtml(item.title?.rendered || ''),
      excerpt: stripHtml(item.excerpt?.rendered || ''),
    })).filter(r => r.url && r.title);
  } catch {
    return []; // fail open
  }
}

/**
 * Query github-code source (GitHub API code search).
 * Endpoint: /search/code?q=<query>+repo:<owner/repo>
 * Returns: [{ url, title, excerpt }]
 */
async function queryGitHubCode(source, query, trace) {
  try {
    const url = new URL(source.base);
    const q = `${query} repo:${source.repo}`;
    url.searchParams.set(source.searchParam || 'q', q);
    url.searchParams.set('per_page', String(MAX_RESULTS_PER_SOURCE));

    const res = await fetchWithTimeout(url.toString(), {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'plato-wordpress-info-plugin',
      },
    }, trace, searchPurpose(source, query));
    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data.items)) return [];

    return data.items.map(item => ({
      url: item.html_url || '',
      title: stripHtml(`${item.name} (${item.path})` || ''),
      excerpt: stripHtml(`Repository: ${item.repository?.full_name || 'N/A'}`),
    })).filter(r => r.url && r.title);
  } catch {
    return []; // fail open
  }
}

/**
 * Route a single query to the appropriate source handler.
 */
async function querySource(source, query, trace) {
  switch (source.kind) {
    case 'wporg-docs':
      return await queryWporgDocs(source, query, trace);
    case 'make-blogs':
      return await queryMakeBlogs(source, query, trace);
    case 'github-code':
      return await queryGitHubCode(source, query, trace);
    default:
      return [];
  }
}

/**
 * Execute a query plan from the planner agent.
 * @param {Array} queries - [{ text, sources: ['wporg-docs', 'make-blogs', ...] }]
 * @param {Array} availableSources - SOURCES array from sources.js
 * @param {object} [trace] - the host's recorder on a traced lesson start (`ctx.trace`); omit otherwise
 * @returns {Promise<Array>} - [{ query, results: [{ url, title, excerpt }] }]
 */
export async function executeQueries(queries, availableSources, trace = null) {
  const results = [];

  for (const q of queries) {
    const queryResults = [];
    const sourcesToQuery = availableSources.filter(s => q.sources.includes(s.kind));

    // Run all sources for this query in parallel
    const sourcePromises = sourcesToQuery.map(source => querySource(source, q.text, trace));
    const sourceResults = await Promise.all(sourcePromises);

    // Flatten and dedupe by URL
    const seen = new Set();
    for (const srcResults of sourceResults) {
      for (const item of srcResults) {
        if (item.url && !seen.has(item.url)) {
          seen.add(item.url);
          queryResults.push(item);
        }
      }
    }

    results.push({
      query: q.text,
      results: queryResults,
    });
  }

  return results;
}
