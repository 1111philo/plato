export default function UserMessage({ content, label }) {
  return (
    <div className="flex justify-end"
      data-chat-message="user" tabIndex={-1}
    >
      <span className="sr-only">You said: </span>
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-base text-primary-foreground font-sans break-words overflow-hidden">
        <p>{label && <strong>{label}: </strong>}{content}</p>
      </div>
    </div>
  );
}
