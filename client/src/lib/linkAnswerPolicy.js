const URL_REGEX = /https?:\/\/[^\s<>"']+/g;
const MIN_MANUAL_WORDS = 8;
const COMFORTABLE_MANUAL_WORDS = MIN_MANUAL_WORDS * 2;
const WORD_REGEX = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'-]*/gu;
const CJK_CHAR_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const CHATGPT_HOSTS = new Set(['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com']);
const CLAUDE_HOSTS = new Set(['claude.ai', 'www.claude.ai']);
const IMPORTED_MARKER_PATTERN = /\[(\/?)(LINK_CONTEXT|SYSTEM|DEVELOPER|USER|ASSISTANT|TOOL|INST|INSTRUCTION|INSTRUCTIONS|PROMPT)\]/gi;
const LINK_CONTEXT_BLOCK_PATTERN = /\[LINK_CONTEXT\][\s\S]*?\[\/LINK_CONTEXT\]/gi;

export function hasSupportedShareUrl(text) {
  const matches = stripLearnerControlBlocksForClassification(String(text || '')).match(URL_REGEX) || [];
  return matches.some(raw => {
    const trimmed = raw.trim().replace(/[)\].,!?;:]+$/g, '');
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'https:') return false;
      if (url.username || url.password) return false;
      if (CHATGPT_HOSTS.has(url.hostname) && url.pathname.startsWith('/share/')) return true;
      if (CLAUDE_HOSTS.has(url.hostname) && url.pathname.startsWith('/share/')) return true;
      return false;
    } catch {
      return false;
    }
  });
}

export function getLinkAnswerPolicy(text) {
  const classification = classifyLinkSubmission(text);

  if (classification.status === 'no_url') {
    return { hasUrl: false, status: 'no_url', blocked: false, message: '' };
  }

  if (classification.status === 'no_explanation') {
    return {
      hasUrl: true,
      status: classification.status,
      blocked: true,
      message: 'Add a short explanation in your own words so your coach can assess your thinking. Links are welcome as context, but they are not enough on their own.',
    };
  }

  if (classification.status === 'low_signal') {
    return {
      hasUrl: true,
      status: classification.status,
      blocked: true,
      message: 'Please say what the link is, whether it is your own work, and what part your coach should evaluate.',
    };
  }

  if (classification.status === 'ambiguous_artifact') {
    return {
      hasUrl: true,
      status: classification.status,
      blocked: true,
      message: 'Please clarify whether this linked work is yours and what part your coach should evaluate.',
    };
  }

  if (classification.status === 'submitted_artifact') {
    const importable = hasSupportedShareUrl(text);
    return {
      hasUrl: true,
      status: classification.status,
      blocked: false,
      message: importable
        ? 'Link submitted as your work. Your coach will evaluate imported content when available; if the link cannot be imported, paste the key text or upload a screenshot.'
        : 'Link included, but your coach cannot browse arbitrary websites; paste the key text or upload a screenshot if the linked content itself needs evaluation.',
    };
  }

  return {
    hasUrl: true,
    status: classification.status,
    blocked: false,
    message: 'Link added as context. Your coach will assess your written explanation first; if the link cannot be imported, your explanation still goes through.',
  };
}

export function getLinkSubmissionGuidance(text) {
  const policy = getLinkAnswerPolicy(text || '');
  if (!policy.hasUrl) return null;

  const supported = 'Public/readable ChatGPT/Claude share links can be imported; other URLs are context only. If a share link is private or expired, make it public and resend it, or paste key text or upload a screenshot.';
  if (policy.blocked) {
    return {
      tone: 'warning',
      message: `Add context before sending: say what the link is, whether it is your own work, source, or evidence, and what part your coach should evaluate. ${supported}`,
    };
  }

  const importable = hasSupportedShareUrl(text);

  if (policy.status === 'submitted_artifact') {
    if (importable) {
      return {
        tone: 'success',
        message: `Link will be submitted as your work. ${supported} If it cannot be imported, paste key text or upload a screenshot.`,
      };
    }
    return {
      tone: 'info',
      message: 'Your coach cannot browse arbitrary websites. Your written framing will be sent, but paste the key text or upload a screenshot if the linked content itself needs evaluation.',
    };
  }

  return {
    tone: 'info',
    message: `Link will be added as context. Coach assesses your explanation first. ${supported}`,
  };
}

export function classifyLinkSubmission(text) {
  const value = stripLearnerControlBlocksForClassification(typeof text === 'string' ? text : '');
  const urls = value.match(URL_REGEX) || [];
  if (!urls.length) return { status: 'no_url', words: 0 };

  const withoutUrls = value.replace(URL_REGEX, ' ');
  const words = countExplanationWords(withoutUrls);
  const normalized = normalizeEnglishText(withoutUrls);

  if (!words) return { status: 'no_explanation', words: 0 };
  if (isSubmittedArtifact(normalized)) return { status: 'submitted_artifact', words };
  if (isAmbiguousArtifact(normalized)) return { status: 'ambiguous_artifact', words };
  if (words < MIN_MANUAL_WORDS || (words < COMFORTABLE_MANUAL_WORDS && isLowSignal(normalized))) {
    return { status: 'low_signal', words };
  }
  return { status: 'source_context', words };
}

function countExplanationWords(text) {
  const value = String(text || '');
  const wordCount = (value.match(WORD_REGEX) || []).length;
  const cjkCount = (value.match(CJK_CHAR_REGEX) || []).length;
  return Math.max(wordCount, cjkCount);
}

function normalizeEnglishText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLearnerControlBlocksForClassification(text) {
  return String(text || '')
    .replace(LINK_CONTEXT_BLOCK_PATTERN, ' ')
    .replace(IMPORTED_MARKER_PATTERN, ' ');
}

function isSubmittedArtifact(text) {
  return [
    /\b(this is|here is|here's)\s+my\s+(final\s+)?(artifact|work|submission|project|prototype|draft|essay|page|site|design|copy|prompt|analysis)\b/,
    /\bmy\s+(final\s+)?(artifact|work|submission|project|prototype|draft|essay|page|site|design|copy|prompt|analysis)\s+(is|lives|appears|starts)\b/,
    /\bi\s+(wrote|made|created|built|designed|drafted|published)\s+(this|the|my)\b/,
    /\bplease\s+evaluate\s+(my|this)\s+(artifact|work|submission|project|prototype|draft|essay|page|site|design|copy|prompt|analysis)\b/,
  ].some(pattern => pattern.test(text));
}

function isAmbiguousArtifact(text) {
  return /\b(this is mine|my link|my url|my answer is here|my response is here)\b/.test(text);
}

function isLowSignal(text) {
  const lowSignalPattern = /\b(here is|here's|see this|check this|look at this|this explains|i used this|i agree with this|the link|my answer today)\b/;
  const substantivePattern = /\b(because|conclusion|stronger|weaker|evidence|impact|ranked|specific|demonstrates|means|shows|compare|evaluate|reason)\b/;
  return lowSignalPattern.test(text) && !substantivePattern.test(text);
}
