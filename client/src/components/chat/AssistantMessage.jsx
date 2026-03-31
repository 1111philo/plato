import { renderMd } from '../../lib/helpers.js';

export default function AssistantMessage({ content }) {
  // Try to parse JSON (agent responses wrap message in { message: "..." })
  let text = content;
  try {
    const parsed = JSON.parse(content);
    text = parsed.message || content;
  } catch { /* plain text */ }

  return (
    <div className="msg msg-response" role="article" aria-label="Coach message">
      <div dangerouslySetInnerHTML={{ __html: renderMd(text) }} />
    </div>
  );
}
