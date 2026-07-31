export const APP_TIME_ZONE = "Asia/Kathmandu";

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function parseDateOnlyParts(dateValue: string) {
  const [yearValue, monthValue, dayValue] = dateValue.split("-").map(Number);
  return {
    year: yearValue || 1970,
    month: monthValue || 1,
    day: dayValue || 1,
  };
}

export function getLocalDateString(date = new Date()) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

export function addCalendarDays(dateValue: string, days: number) {
  const { year, month, day } = parseDateOnlyParts(dateValue);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
}

export function formatDateOnly(dateValue: string, options?: Intl.DateTimeFormatOptions) {
  const { year, month, day } = parseDateOnlyParts(dateValue);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  return new Intl.DateTimeFormat("en-NP", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
    timeZone: "UTC",
  }).format(date);
}

export function formatDateTimeInNepal(dateValue: string | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!dateValue) return "Not set";
  const hasDateTimeStyle = Boolean(options?.dateStyle || options?.timeStyle);

  return new Intl.DateTimeFormat("en-NP", {
    ...(hasDateTimeStyle
      ? {}
      : {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
    ...options,
    timeZone: APP_TIME_ZONE,
  }).format(new Date(dateValue));
}
