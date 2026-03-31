import { useModal } from '../../contexts/ModalContext.jsx';

export default function ConfirmModal({ title, message, cancelLabel = 'Cancel', confirmLabel = 'Confirm', confirmClass = 'danger-btn', onConfirm }) {
  const { hide } = useModal();

  return (
    <>
      <h2>{title}</h2>
      <p>{message}</p>
      <div className="action-bar">
        <button className="secondary-btn" onClick={hide}>{cancelLabel}</button>
        <button className={confirmClass} onClick={() => { hide(); onConfirm(); }}>{confirmLabel}</button>
      </div>
    </>
  );
}
