import { createContext, useContext, useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';

const ModalContext = createContext(null);

export function ModalProvider({ children }) {
  const [modal, setModal] = useState(null); // { content, role, label }

  const show = useCallback((content, role = 'dialog', label = '') => {
    setModal({ content, role, label });
  }, []);

  const hide = useCallback(() => setModal(null), []);

  const isAlert = modal?.role === 'alertdialog';

  return (
    <ModalContext.Provider value={{ show, hide, isOpen: !!modal }}>
      {children}
      {isAlert ? (
        <AlertDialog.Root open={!!modal} onOpenChange={(open) => { if (!open) hide(); }}>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="modal-overlay" />
            <AlertDialog.Content className="modal" aria-label={modal?.label || undefined}>
              <VisuallyHidden><AlertDialog.Title>{modal?.label || 'Dialog'}</AlertDialog.Title></VisuallyHidden>
              {modal?.content}
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : (
        <Dialog.Root open={!!modal} onOpenChange={(open) => { if (!open) hide(); }}>
          <Dialog.Portal>
            <Dialog.Overlay className="modal-overlay" />
            <Dialog.Content className="modal" aria-label={modal?.label || undefined}>
              <VisuallyHidden><Dialog.Title>{modal?.label || 'Dialog'}</Dialog.Title></VisuallyHidden>
              {modal?.content}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within ModalProvider');
  return ctx;
}
