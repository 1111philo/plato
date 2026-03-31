export default function Spinner({ light = false }) {
  return (
    <span
      className={`spinner${light ? ' spinner-light' : ''}`}
      aria-hidden="true"
    />
  );
}
