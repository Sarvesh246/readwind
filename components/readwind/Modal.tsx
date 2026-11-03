"use client";
import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Icon } from "./Icon";
export function Modal({
  title,
  children,
  onClose,
  className = "",
  dismissible = true,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`readwind-modal ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if(dismissible)onClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === ref.current) onClose();
      }}
    >
      <motion.div
        className="modal-content"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 340, damping: 26 }}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          {dismissible && <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>}
        </header>
        {children}
      </motion.div>
    </dialog>
  );
}
