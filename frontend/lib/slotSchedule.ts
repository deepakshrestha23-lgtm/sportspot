const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseDateAtNoon(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

export function estimateGeneratedSlots({
  startDate,
  endDate,
  availableDays,
  openingTime,
  closingTime,
  durationMinutes,
}: {
  startDate: string;
  endDate: string;
  availableDays: string[];
  openingTime: string;
  closingTime: string;
  durationMinutes: string | number;
}) {
  const start = parseDateAtNoon(startDate);
  const end = parseDateAtNoon(endDate);
  const opening = timeToMinutes(openingTime);
  const closing = timeToMinutes(closingTime);
  const duration = Number(durationMinutes);
  if (!start || !end || start > end || opening === null || closing === null || closing <= opening || !duration) return 0;

  const selectedDays = new Set(availableDays);
  const slotsPerSelectedDay = Math.floor((closing - opening) / duration);
  let selectedDayCount = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (selectedDays.has(WEEKDAYS[cursor.getUTCDay()])) selectedDayCount += 1;
  }
  return selectedDayCount * slotsPerSelectedDay;
}
