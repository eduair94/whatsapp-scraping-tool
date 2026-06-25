import { useEffect } from 'react';

/**
 * Closes a modal when the Escape key is pressed while it is open. Keeps the
 * listener scoped to the open lifetime so multiple modals don't fight.
 */
export function useModalClose(isOpen: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);
}
