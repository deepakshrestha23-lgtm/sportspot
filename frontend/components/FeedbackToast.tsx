"use client";

import { useEffect } from "react";

import { useToast } from "@/components/ToastProvider";
import type { ToastType } from "@/components/ToastProvider";

type FeedbackToastProps = {
  message: string;
  type?: ToastType;
  onClose?: () => void;
};

export default function FeedbackToast({ message, onClose, type = "info" }: FeedbackToastProps) {
  const { showToast } = useToast();

  useEffect(() => {
    if (!message) return;
    showToast({ message, type });
    onClose?.();
  }, [message, onClose, showToast, type]);

  return null;
}