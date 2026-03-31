import { renderMd } from '../../lib/helpers.js';

export default function AssistantMessage({ content }) {
  let text = content;
  try {
    const parsed = JSON.parse(content);
    text = parsed.message || content;
  } catch { /* plain text */ }

  return (
    <div className="flex justify-start" role="article" aria-label="Coach message">
      <div className="max-w-[85%] px-1 py-2 text-base prose prose-base prose-neutral dark:prose-invert font-serif">
        <div dangerouslySetInnerHTML={{ __html: renderMd(text) }} />
      </div>
    </div>
  );
}
