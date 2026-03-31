export default function UserMessage({ content, label }) {
  return (
    <div className="flex justify-end" role="article" aria-label="Your message">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground font-sans">
        <p>{label && <strong>{label}: </strong>}{content}</p>
      </div>
    </div>
  );
}
