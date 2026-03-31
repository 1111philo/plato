import { renderMd } from '../../lib/helpers.js';

export default function AssistantMessage({ content }) {
  let text = content;
  try {
    const parsed = JSON.parse(content);
    text = parsed.message || content;
  } catch { /* plain text */ }

  return (
    <div className="flex justify-start" role="article" aria-label="Coach message">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-4 py-3 text-base prose prose-base prose-neutral dark:prose-invert font-serif">
        <div dangerouslySetInnerHTML={{ __html: renderMd(text) }} />
      </div>
    </div>
  );
}
