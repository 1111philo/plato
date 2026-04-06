/** XSS-safe text escaping. */
export function esc(s) {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

/** Lightweight markdown to HTML. Handles bold, italic, headings, lists, links, and line breaks. */
export function renderMd(text) {
  let escaped = esc(text);
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

/** Detect and linkify URLs in escaped HTML. */
export function linkify(escaped) {
  return escaped.replace(
    /https?:\/\/[^\s<>"']+/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`
  );
}