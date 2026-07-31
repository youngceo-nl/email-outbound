const DUTCH_MONTHS = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

// Same "D month" format as appointment-setting-systems' Meetings sheet
// (api/_lib/sheets.js's parseDutchDate) - no year column, so the caller
// supplies which year to assume.
export function parseDutchMeetingDate(label: string, referenceYear: number): Date | null {
  const match = (label || "").trim().match(/^(\d{1,2})\s+([a-zé]+)$/i);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const monthIndex = DUTCH_MONTHS.indexOf(match[2].toLowerCase());
  if (monthIndex === -1) return null;
  return new Date(referenceYear, monthIndex, day);
}

export function countMeetingsInMonth(rows: string[][], monthDate: Date): number {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  return rows.filter((row) => {
    const date = parseDutchMeetingDate(row[0] ?? "", year);
    return date !== null && date.getFullYear() === year && date.getMonth() === month;
  }).length;
}
