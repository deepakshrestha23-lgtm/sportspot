import axios from "axios";

import { emitToast } from "@/lib/toast";

type ApiErrorMessageOptions = {
  notify?: boolean;
};

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

export function getApiErrorMessage(requestError: unknown, fallbackMessage: string, options: ApiErrorMessageOptions = {}) {
  const notify = options.notify !== false;
  const returnMessage = (message: string) => {
    if (notify) emitToast({ message, type: "error" });
    return message;
  };
  let message = fallbackMessage;

  if (axios.isAxiosError(requestError)) {
    if (requestError.code === "ERR_CANCELED") {
      return fallbackMessage;
    }

    if (!requestError.response) {
      message = ["ECONNABORTED", "ETIMEDOUT"].includes(requestError.code || "")
        ? "SportSpot is taking longer than expected. Please try again in a moment."
        : "SportSpot is temporarily unavailable. Please try again in a moment.";
      return returnMessage(message);
    }

    const data = requestError.response.data;

    if (data && typeof data === "object") {
      const errors = data as Record<string, unknown>;
      const detail = userMessage(errors.detail);
      if (detail) {
        return returnMessage(detail);
      }

      const firstError = userMessage(Object.values(errors).find(Boolean));

      if (firstError) {
        return returnMessage(firstError);
      }
    }

    const responseMessage = userMessage(data);
    if (responseMessage) {
      return returnMessage(responseMessage);
    }
  }

  return returnMessage(message);
}
