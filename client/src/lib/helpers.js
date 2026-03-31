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
  escaped = escaped.replace(/\n/g, '<br>');
  // Clean up <br> tags adjacent to block-level list elements
  escaped = escaped.replace(/<br>(<\/?[uo]l>)/g, '$1');
  escaped = escaped.replace(/(<\/?[uo]l>)<br>/g, '$1');
  return escaped;
}

/** Detect and linkify URLs in escaped HTML. */
export function linkify(escaped) {
  return escaped.replace(
    /https?:\/\/[^\s<>"']+/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`
  );
}