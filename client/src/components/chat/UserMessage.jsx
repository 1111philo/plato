import { esc } from '../../lib/helpers.js';

export default function UserMessage({ content, label }) {
  return (
    <div className="msg msg-user" role="article" aria-label="Your message">
      <p>{label && <strong>{label}: </strong>}{content}</p>
    </div>
  );
}
