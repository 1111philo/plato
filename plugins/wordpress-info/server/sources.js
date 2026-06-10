/**
 * WordPress Info plugin — source definitions.
 *
 * KEYWORDS: WordPress-related terms the planner checks for
 * SOURCES: API endpoints the query executor calls
 * ALLOWED_HOSTS: SSRF defense allowlist
 */

export const KEYWORDS = [
  'wordpress',
  'wp',
  'gutenberg',
  'woocommerce',
  'wpcom',
  'wordpress.org',
  'wp-admin',
  'wp-content',
  'wpdb',
  'wp_query',
  'hooks',
  'filters',
  'actions',
  'shortcodes',
  'rest api',
  'block editor',
  'classic editor',
  'multisite',
  'plugin',
  'theme',
];

/**
 * Source definitions. Each source has:
 * - id: unique identifier
 * - label: display name shown to learners
 * - kind: 'wporg-docs' | 'make-blogs' | 'github-code'
 * - base: API endpoint base URL
 * - searchParam: query parameter name (default: 'search')
 */
export const SOURCES = [
  {
    id: 'wporg-dev-docs',
    label: 'WordPress Developer Docs',
    kind: 'wporg-docs',
    base: 'https://developer.wordpress.org/wp-json/wp/v2/search',
    searchParam: 'search',
  },
  {
    id: 'make-core',
    label: 'Make WordPress Core',
    kind: 'make-blogs',
    base: 'https://make.wordpress.org/core/wp-json/wp/v2/posts',
    searchParam: 'search',
  },
  {
    id: 'make-plugins',
    label: 'Make WordPress Plugins',
    kind: 'make-blogs',
    base: 'https://make.wordpress.org/plugins/wp-json/wp/v2/posts',
    searchParam: 'search',
  },
  {
    id: 'make-themes',
    label: 'Make WordPress Themes',
    kind: 'make-blogs',
    base: 'https://make.wordpress.org/themes/wp-json/wp/v2/posts',
    searchParam: 'search',
  },
  {
    id: 'github-wp-core',
    label: 'WordPress Core (GitHub)',
    kind: 'github-code',
    base: 'https://api.github.com/search/code',
    repo: 'WordPress/WordPress',
    searchParam: 'q',
  },
];

/**
 * SSRF defense: only these hosts are allowed. The query executor validates
 * every fetched URL against this list before making the request.
 */
export const ALLOWED_HOSTS = [
  'developer.wordpress.org',
  'make.wordpress.org',
  'api.github.com',
];
