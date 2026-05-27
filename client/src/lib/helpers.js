/** XSS-safe text escaping. */
export function esc(s) {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

/**
 * Protocols safe to drop into an href. Coach/markdown output is untrusted, so
 * a `javascript:`, `data:`, or `vbscript:` URL would become a clickable XSS
 * vector (`esc()` neutralizes HTML chars but not the URL scheme). We allowlist
 * http(s) and mailto and reject everything else. Leading whitespace is trimmed
 * first so `[x]( javascript:…)` can't sneak past the anchor.
 */
export function isSafeUrl(url) {
  return /^(https?:\/\/|mailto:)/i.test(String(url).trim());
}

/** Lightweight markdown to HTML. Handles bold, italic, headings, lists, links, and line breaks. */
export function renderMd(text) {
  let escaped = esc(text);
  // Markdown links [text](url) — must come before heading/bold/italic replacements
  // so nested formatting inside link text is handled correctly. Unsafe-protocol
  // URLs are left as the literal markdown text rather than rendered as anchors.
  escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) =>
    isSafeUrl(url) ? `<a href="${url.trim()}" target="_blank" rel="noopener">${label}</a>` : match
  );
  escaped = escaped.replace(/^### (.+)$/gm, '<strong style="font-size:0.85rem;">$1</strong>');
  escaped = escaped.replace(/^## (.+)$/gm, '<strong style="font-size:0.9rem;">$1</strong>');
  escaped = escaped.replace(/^# (.+)$/gm, '<strong style="font-size:1rem;">$1</strong>');
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\*(.+?)\*/g, '<em>$1</em>');
  escaped = escaped.replace(/^[-*] (.+)/gm, '<li>$1</li>');
  escaped = escaped.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
  escaped = escaped.replace(/^\d+[.)]\s+(.+)/gm, '<li>$1</li>');
  escaped = escaped.replace(/(<li>.*<\/li>\n?)+/g, (match) =>
    match.includes('<ul>') ? match : `<ol>${match}</ol>`
  );
  escaped = linkify(escaped);
  // Convert markdown tables to HTML tables
  escaped = escaped.replace(/((?:^\|.+\|$\n?)+)/gm, (block) => {
    const rows = block.trim().split('\n').filter(r => r.trim());
    if (rows.length < 2) return block;
    // Skip separator row (|---|---|)
    const isSeparator = (r) => /^\|[\s-:|]+\|$/.test(r);
    const parseRow = (r) => r.split('|').slice(1, -1).map(c => c.trim());
    const headerCells = parseRow(rows[0]);
    const dataRows = rows.slice(isSeparator(rows[1]) ? 2 : 1);
    let html = '<table class="border-collapse text-sm w-full my-2"><thead><tr>';
    for (const cell of headerCells) html += `<th class="border border-border px-3 py-1.5 text-left font-medium bg-muted/50">${cell}</th>`;
    html += '</tr></thead><tbody>';
    for (const row of dataRows) {
      if (isSeparator(row)) continue;
      const cells = parseRow(row);
      html += '<tr>';
      for (const cell of cells) html += `<td class="border border-border px-3 py-1.5">${cell}</td>`;
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  });
  escaped = escaped.replace(/\n/g, '<br>');
  // Clean up <br> tags adjacent to block-level elements
  escaped = escaped.replace(/<br>(<\/?(?:[uo]l|table|thead|tbody|tr)>)/g, '$1');
  escaped = escaped.replace(/(<\/?(?:[uo]l|table|thead|tbody|tr)>)<br>/g, '$1');
  return escaped;
}

/** Detect and linkify bare URLs in escaped HTML. */
export function linkify(escaped) {
  // Skip URLs already inside an <a>…</a> — markdown links ([text](url)) are
  // rendered to anchors earlier in renderMd, and re-matching the URL inside
  // their href would nest anchors and corrupt the markup. Split on existing
  // anchors (capturing group keeps them) and only linkify the segments
  // between them.
  return escaped
    .split(/(<a\b[^>]*>.*?<\/a>)/gs)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(
      /https?:\/\/[^\s<>"']+/g,
      (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`
    )))
    .join('');
}