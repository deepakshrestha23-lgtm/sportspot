import axios from "axios";

export function getApiErrorMessage(requestError: unknown, fallbackMessage: string) {
  if (axios.isAxiosError(requestError)) {
    if (!requestError.response) {
      return "Cannot connect to the backend API. Please make sure Django is running at http://127.0.0.1:8000.";
    }

    const data = requestError.response.data;

    if (data && typeof data === "object") {
      const errors = data as Record<string, unknown>;
      const firstError = Object.values(errors).find(Boolean);

      if (Array.isArray(firstError) && typeof firstError[0] === "string") {
        return firstError[0];
      }

      if (typeof firstError === "string") {
        return firstError;
      }
    }

    if (typeof data === "string") {
      return data;
    }
  }

  return fallbackMessage;
}
