"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

/**
 * Right-side slide-over used for per-device details, backed by a native
 * <dialog>. showModal() lifts it into the top layer, so focus is truly
 * contained (Tab cannot reach the page behind the drawer) and Esc raises the
 * `cancel` event, which we route through onClose so parent state stays in
 * sync. Body scroll stays locked manually and focus returns to the trigger on
 * close. Content is rendered by the parent so the existing DeviceDetail stays
 * the single source of truth.
 */
export function DeviceDrawer({
  open,
  label,
  onClose,
  children,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (dialog.open) dialog.close(); // native close also restores focus
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    // Clicks land on the <dialog> itself when they hit ::backdrop or padding —
    // only treat them as backdrop dismissals when outside the panel rectangle.
    const rect = dialogRef.current?.getBoundingClientRect();
    if (
      rect &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    ) {
      closeRef.current();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="drawer"
      aria-label={label || "Device details"}
      onCancel={(event) => {
        event.preventDefault(); // stay mounted until the parent flips `open`
        closeRef.current();
      }}
      onClick={onBackdropClick}
    >
      <div className="drawer-head">
        <strong>{label}</strong>
        <button type="button" className="ghost icon-btn" onClick={onClose}>
          Close ✕
        </button>
      </div>
      {children}
    </dialog>
  );
}
