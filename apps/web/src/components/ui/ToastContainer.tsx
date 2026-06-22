import { Toast } from './Toast';

interface ToastMessage {
  id: string;
  message: string;
  type?: 'success' | 'error' | 'info' | 'warning';
}

interface ToastContainerProps {
  toasts?: ToastMessage[];
  onRemove?: (id: string) => void;
}

const EMPTY_TOASTS: ToastMessage[] = [];
const NOOP = () => {};

export function ToastContainer({ toasts = EMPTY_TOASTS, onRemove = NOOP }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => onRemove(toast.id)}
        />
      ))}
    </div>
  );
}
