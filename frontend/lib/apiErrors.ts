import axios from "axios";

import { emitToast } from "@/lib/toast";

function unwrapApiValue(value: unknown): unknown {
  if (Array.isArray(value)) return unwrapApiValue(value[0]);
  return value;
}

export function getApiErrorField(requestError: unknown, field: string) {
  if (!axios.isAxiosError(requestError)) return null;
  const data = requestError.response?.data;
  if (!data || typeof data !== "object") return null;
  const value = unwrapApiValue((data as Record<string, unknown>)[field]);
  return typeof value === "string" ? value : null;
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
      const detail = unwrapApiValue(errors.detail);
      if (typeof detail === "string") {
        emitToast({ message: detail, type: "error" });
        return detail;
      }

      const firstError = unwrapApiValue(Object.values(errors).find(Boolean));

      if (typeof firstError === "string") {
        emitToast({ message: firstError, type: "error" });
        return firstError;
      }
    }

    if (typeof data === "string") {
      emitToast({ message: data, type: "error" });
      return data;
    }
  }

  emitToast({ message, type: "error" });
  return message;
}