"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Right-side slide-over used for per-device details. ESC and a backdrop click
 * close it; focus moves into the panel on open and returns to the previously
 * focused element on close. Content is rendered by the parent so the existing
 * DeviceDetail stays the single source of truth.
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
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="drawer-backdrop" aria-hidden="true" onClick={() => closeRef.current()} />
      <div
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={label || "Device details"}
        tabIndex={-1}
      >
        <div className="drawer-head">
          <strong>{label}</strong>
          <button type="button" className="ghost icon-btn" onClick={onClose}>
            Close ✕
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
