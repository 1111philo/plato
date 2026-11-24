/**
 * Small checks shared by the agent modules: reading a JSON reply the way the
 * app does (orchestrator.parseJSON tolerates code fences and surrounding
 * text), the reply's language, and counting sentences and questions.
 */
export function parseJSON(text) {
  const t = String(text ?? '').trim();
  const fenced = t.replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '').trim();
  for (const c of [t, fenced, (fenced.match(/\{[\s\S]*\}/) || [''])[0]]) {
    try { return JSON.parse(c); } catch { /* next */ }
  }
  return null;
}

const STOP = {
  English: /\b(the|and|you|your|to|of|is|that|what|this|with|for)\b/gi,
  Spanish: /\b(el|la|los|las|de|que|en|con|para|una|por|tu|tus|es|como|qué|su|sus)\b/gi,
};
const BENGALI = /[ঀ-৿]/g;
const CJK = /[぀-ヿ㐀-鿿가-힯]/;

/** True when `text` is written in `language` (English, Spanish, Bengali), with no other script mixed in. */
export function inLanguage(text, language = 'English') {
  const t = String(text ?? '');
  if (CJK.test(t)) return false;
  if (language === 'Bengali') return (t.match(BENGALI) || []).length > t.replace(/\s/g, '').length * 0.3;
  const count = (re) => (t.match(re) || []).length;
  if (language === 'Spanish') return count(STOP.Spanish) > count(STOP.English);
  return count(STOP.English) >= count(STOP.Spanish);
}

export const sentences = (t) => (String(t).replace(/\[[^\]]*\]/g, '').match(/[^.!?]+[.!?]+/g) || [t]).filter((s) => s.trim().length > 3).length;
export const questions = (t) => (String(t).match(/\?/g) || []).length;
export const words = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;
