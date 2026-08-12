import axios from "axios";

import { emitToast } from "@/lib/toast";

function unwrapApiValue(value: unknown): unknown {
  if (Array.isArray(value)) return unwrapApiValue(value[0]);
  return value;
}

function isTechnicalHtml(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html") || normalized.includes("traceback") || normalized.includes("improperlyconfigured");
}

function userMessage(value: unknown): string | null {
  const unwrapped = unwrapApiValue(value);
  if (typeof unwrapped !== "string" || isTechnicalHtml(unwrapped)) return null;
  const message = unwrapped.trim();
  return message || null;
}

export function getApiErrorField(requestError: unknown, field: string) {
  if (!axios.isAxiosError(requestError)) return null;
  const data = requestError.response?.data;
  if (!data || typeof data !== "object") return null;
  const value = unwrapApiValue((data as Record<string, unknown>)[field]);
  return userMessage(value);
}

export function getApiErrorMessage(requestError: unknown, fallbackMessage: string) {
  let message = fallbackMessage;

  if (axios.isAxiosError(requestError)) {
    if (!requestError.response) {
      message = "We could not connect to SportSpot right now. Please check your internet connection and try again.";
      emitToast({ message, type: "error" });
      return message;
    }

    const data = requestError.response.data;

    if (data && typeof data === "object") {
      const errors = data as Record<string, unknown>;
      const detail = userMessage(errors.detail);
      if (detail) {
        emitToast({ message: detail, type: "error" });
        return detail;
      }

      const firstError = userMessage(Object.values(errors).find(Boolean));

      if (firstError) {
        emitToast({ message: firstError, type: "error" });
        return firstError;
      }
    }

    const responseMessage = userMessage(data);
    if (responseMessage) {
      emitToast({ message: responseMessage, type: "error" });
      return responseMessage;
    }
  }

  emitToast({ message, type: "error" });
  return message;
}