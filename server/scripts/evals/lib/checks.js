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
  Spanish: /(?<![\p{L}])(el|la|los|las|de|que|en|con|para|una|un|por|tu|tus|es|son|como|cómo|qué|su|sus|no|lo|sí|tú|mi|mis|más|muy|pero|ya|esta|este|eso|ese|esas|esos|aún|también|cuando|dónde|porque)(?![\p{L}])/giu,
};
const BENGALI = /[ঀ-৿]/g;
export const CJK = /[぀-ヿ㐀-鿿가-힯]/;

/** True when `text` is written in `language` (English, Spanish, Bengali), with no other script mixed in. */
export function inLanguage(text, language = 'English') {
  const t = String(text ?? '');
  if (CJK.test(t)) return false;
  if (language === 'Bengali') return (t.match(BENGALI) || []).length > t.replace(/\s/g, '').length * 0.3;
  const count = (re) => (t.match(re) || []).length;
  // ¿ ¡ ñ and accented vowels are Spanish too: a short reply can have few common words.
  if (language === 'Spanish') return count(STOP.Spanish) + Math.min(3, (t.match(/[¿¡ñáéíóú]/gi) || []).length) > count(STOP.English);
  return count(STOP.English) >= count(STOP.Spanish);
}

// A full stop inside "e.g.", "$28.50" or "livingwage.mit.edu" doesn't end a
// sentence (C37: a three-sentence reply with "(e.g., …)" counted as six).
const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|approx|Mr|Mrs|Ms|Dr|St)\./gi;
export const sentences = (t) => (String(t).replace(/\[[^\]]*\]/g, '').replace(ABBREVIATIONS, (m) => m.replace(/\./g, '')).replace(/(\w)\.(\w)/g, '$1$2').match(/[^.!?]+[.!?]+/g) || [t]).filter((s) => s.trim().length > 3).length;
export const questions = (t) => (String(t).match(/\?/g) || []).length;
export const words = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;

/** The Coach said it reported or escalated something (it can't). */
export const ESCALATED = /\bI(?:'ve| have| will|'ll)\s+(?:reported|flagged|escalated|let (?:the|your) (?:team|admin)|notified|passed (?:this|it) (?:on|along))/i;
/** Asked for something plato can't take: video, audio, a file, a terminal. */
const CANT_TAKE_ASK = /\b(?:record|upload|send|share|attach|submit)\b[^.?!\n]{0,40}\b(?:video|audio|voice (?:memo|note)|pdf|zip|word doc(?:ument)?|file)\b|\b(?:open|run)\b[^.?!\n]{0,20}\b(?:terminal|command line|powershell)\b/i;
// Uploading to another platform is part of some lessons (adding a PDF to
// LinkedIn's Featured section, W14): that sentence isn't asking plato for it.
const ELSEWHERE = /\b(?:linkedin|github|google (?:drive|docs)|canva|wordpress|youtube|carrd|your (?:profile|site|page|portfolio))\b/i;
const HERE = /\b(?:here|to me|with me|in (?:this|the) chat)\b/i;
export const CANT_TAKE = {
  test: (t) => {
    const elsewhere = ELSEWHERE.test(String(t));
    return String(t).split(/(?<=[.!?])\s+|\n+/).some((x) => CANT_TAKE_ASK.test(x) && (!elsewhere || HERE.test(x)));
  },
};
/** Assumed a job the learner never mentioned (not "at work": a lesson's own goal can say it). */
export const WORK = /\b(?:your (?:job|employer|manager|boss|coworkers?|colleagues|workplace|company)|full[- ]time (?:job|role|position|work))\b/i;

// Did a reply write the learner's work for them? Measured with this
// checkout's detector (assessment.draftsForLearner) for every version: an
// older version drafted too, it just didn't detect it, so its own (missing)
// detector would make "at least as good as today" unmeasurable.
const { draftsForLearner } = await import('../../../../client/src/lib/assessment.js');
export const drafts = (text, learnerTexts = []) => draftsForLearner(String(text || ''), learnerTexts);

/** Praising an answer as the learner's insight ("You nailed it", "That's a strong start"). */
export const PRAISE = /\b(?:nailed it|exactly|you got it|spot on|well done|strong start|great (?:job|answer|insight|thinking|start)|that(?:'|’)?s (?:right|correct|it|the key|your voice|perfect)|perfect(?:ly)?)\b/i;
