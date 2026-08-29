export const APP_TIME_ZONE = "Asia/Kathmandu";
// English UI with Nepal time. The timezone controls the clock; the locale keeps
// labels predictable across browsers, including uppercase AM/PM markers.
export const APP_LOCALE = "en-US";
export const BOOKING_SLOT_INTERVAL_MINUTES = 30;

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
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addCalendarDays(dateValue: string, days: number) {
  const { year, month, day } = parseDateOnlyParts(dateValue);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
}

export function formatDateOnly(dateValue: string, options?: Intl.DateTimeFormatOptions) {
  const { year, month, day } = parseDateOnlyParts(dateValue);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  return new Intl.DateTimeFormat(APP_LOCALE, {
    ...(options || {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    timeZone: "UTC",
  }).format(date);
}

export function formatDateTimeInNepal(dateValue: string | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!dateValue) return "Not set";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "Not set";
  const hasDateTimeStyle = Boolean(options?.dateStyle || options?.timeStyle);

  return new Intl.DateTimeFormat(APP_LOCALE, {
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
  }).format(date);
}

function parseClockTime(value: string) {
  const [hourValue, minuteValue] = value.split(":").map(Number);
  if (!Number.isInteger(hourValue) || !Number.isInteger(minuteValue)) return null;
  if (hourValue < 0 || hourValue > 23 || minuteValue < 0 || minuteValue > 59) return null;
  return new Date(Date.UTC(2000, 0, 1, hourValue, minuteValue, 0));
}

/** Format a backend time value such as 18:30:00 without using the browser timezone. */
export function formatTimeValue(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = parseClockTime(value);
  if (!date) return "Not set";
  return new Intl.DateTimeFormat(APP_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
    timeZone: "UTC",
  }).format(date);
}

export function formatTimeRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return "Time to be confirmed";
  const startLabel = formatTimeValue(start);
  const endLabel = end ? formatTimeValue(end) : "";
  return endLabel ? `${startLabel} - ${endLabel}` : startLabel;
}

export function buildTimeOptions(intervalMinutes = BOOKING_SLOT_INTERVAL_MINUTES) {
  const interval = Math.max(1, Math.floor(intervalMinutes));
  return Array.from(
    { length: Math.floor((24 * 60) / interval) },
    (_, index) => {
      const totalMinutes = index * interval;
      return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
    },
  );
}

export function splitDateTimeInput(value: string | null | undefined): [string, string] {
  if (!value) return ["", ""];
  const [date, time] = value.split("T");
  return [date || "", (time || "").slice(0, 5)];
}

export function joinDateTimeInput(date: string, time: string) {
  return date && time ? `${date}T${time}` : "";
}

/** Convert a venue-local date and clock time to an ISO timestamp for the API. */
export function localDateTimeToIso(dateValue: string, timeValue: string) {
  if (!dateValue || !timeValue) return "";
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return "";

  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const zoneParts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(utcGuess).reduce<Record<string, string>>((parts, part) => {
    if (part.type !== "literal") parts[part.type] = part.value;
    return parts;
  }, {});
  const zoneAsUtc = Date.UTC(
    Number(zoneParts.year),
    Number(zoneParts.month) - 1,
    Number(zoneParts.day),
    Number(zoneParts.hour),
    Number(zoneParts.minute),
    Number(zoneParts.second),
  );
  return new Date(utcGuess.getTime() - (zoneAsUtc - utcGuess.getTime())).toISOString();
}

export function parseDateTimeInput(value: string | null | undefined) {
  const [date, time] = splitDateTimeInput(value);
  const iso = localDateTimeToIso(date, time);
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toDateTimeInput(dateValue: Date | string | null | undefined) {
  const date = dateValue instanceof Date ? dateValue : dateValue ? new Date(dateValue) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function toNepalDate(dateValue: Date | string | null | undefined) {
  const input = dateValue instanceof Date ? dateValue : dateValue ? new Date(dateValue) : null;
  return input && !Number.isNaN(input.getTime()) ? getLocalDateString(input) : "";
}

export function toNepalTime(dateValue: Date | string | null | undefined) {
  const input = dateValue instanceof Date ? dateValue : dateValue ? new Date(dateValue) : null;
  if (!input || Number.isNaN(input.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(input).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.hour}:${parts.minute}`;
}
