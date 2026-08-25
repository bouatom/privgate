"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

export type ConfirmOptions = {
  /** Question shown as the dialog heading. */
  title: string;
  /** Optional explanatory sentence under the title. */
  body?: string;
  /** Optional bullet list (e.g. the full risk-reasons list for high-risk approvals). */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive confirms: confirm button and accent switch to the --bad token. */
  danger?: boolean;
};

type PendingConfirm = {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
};

/**
 * Themed replacement for native window.confirm() guards on irreversible
 * actions. Rendered by useConfirm(); resolves false on Esc, Cancel, backdrop
 * click, or a superseding prompt — exactly one boolean per call.
 */
function ConfirmDialog({
  options,
  onSettle,
}: {
  options: ConfirmOptions;
  onSettle: (confirmed: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Initial focus lands on Cancel so Enter can never fire the risky action.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onSettle(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = rootRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
    if (!focusables || focusables.length < 2) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="confirm-overlay" onClick={() => onSettle(false)}>
      <div
        ref={rootRef}
        className={`confirm-dialog ${options.danger ? "danger" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id="confirm-dialog-title">{options.title}</h2>
        {options.body ? <p>{options.body}</p> : null}
        {options.details && options.details.length > 0 ? (
          <ul>
            {options.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
        <div className="row-actions">
          <button ref={cancelRef} type="button" onClick={() => onSettle(false)}>
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className={options.danger ? "danger" : "primary"}
            onClick={() => onSettle(true)}
          >
            {options.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Promise-based confirm for client pages:
 *   const { confirm, dialog } = useConfirm();
 *   if (!(await confirm({ title: "Delete?", danger: true }))) return;
 *   return <>{dialog}</>;
 * Focus returns to the element that opened the prompt once it settles.
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const request = pendingRef.current;
    if (!request) return;
    pendingRef.current = null;
    setPending(null);
    request.resolve(confirmed);
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      // A second prompt supersedes an unanswered one; the old caller gets false.
      pendingRef.current?.resolve(false);
      openerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const request: PendingConfirm = { options, resolve };
      pendingRef.current = request;
      setPending(request);
    });
  }, []);

  const dialog = pending ? (
    <ConfirmDialog options={pending.options} onSettle={settle} />
  ) : null;

  return { confirm, dialog };
}
