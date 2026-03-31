import { renderMd } from '../../lib/helpers.js';

export default function AssistantMessage({ content }) {
  let text = content;
  try {
    const parsed = JSON.parse(content);
    text = parsed.message || content;
  } catch { /* plain text */ }

  return (
    <div className="flex justify-start" role="article" aria-label="Coach message">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm prose prose-sm prose-neutral dark:prose-invert font-serif">
        <div dangerouslySetInnerHTML={{ __html: renderMd(text) }} />
      </div>
    </div>
  );
}
