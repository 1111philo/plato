export default function LoadingBar({ visible }) {
  if (!visible) return null;
  return (
    <div
      className="loading-bar"
      role="progressbar"
      aria-label="Loading"
    />
  );
}
