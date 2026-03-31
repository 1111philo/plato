import { createContext, useContext, useState, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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
        <AlertDialog open={!!modal} onOpenChange={(open) => { if (!open) hide(); }}>
          <AlertDialogContent>
            <AlertDialogTitle className="sr-only">{modal?.label || 'Dialog'}</AlertDialogTitle>
            {modal?.content}
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Dialog open={!!modal} onOpenChange={(open) => { if (!open) hide(); }}>
          <DialogContent showCloseButton={false} aria-label={modal?.label || undefined}>
            <DialogTitle className="sr-only">{modal?.label || 'Dialog'}</DialogTitle>
            {modal?.content}
          </DialogContent>
        </Dialog>
      )}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within ModalProvider');
  return ctx;
}
