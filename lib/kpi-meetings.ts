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

export function countMeetingsInRange(rows: string[][], start: Date, end: Date): number {
  const year = end.getUTCFullYear();
  const startMs = start.getTime();
  const endMs = end.getTime();
  return rows.filter((row) => {
    const date = parseDutchMeetingDate(row[0] ?? "", year);
    if (!date) return false;
    const dateMs = date.getTime();
    return dateMs >= startMs && dateMs <= endMs;
  }).length;
}

import { google } from "googleapis";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sheetsClient: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSheetsClient(): any {
  if (!sheetsClient) {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_SHEETS_CLIENT_ID,
      process.env.GOOGLE_SHEETS_CLIENT_SECRET,
      "http://localhost",
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_SHEETS_REFRESH_TOKEN });
    sheetsClient = google.sheets({ version: "v4", auth });
  }
  return sheetsClient;
}

// Reads the same "Meetings" tab that appointment-setting-systems' Cal.com
// webhook writes to (api/_lib/sheets.js's appendMeeting/getMeetings) - this
// app has no meetings/Cal.com concept of its own, so the shared sheet is the
// source of truth. Returns null (never throws) if the credentials aren't
// configured yet or the request fails, so a missing/broken Sheets connection
// shows "Not connected" on the dashboard instead of crashing the page.
export async function fetchMeetingsBookedThisMonth(): Promise<number | null> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return fetchMeetingsBooked({ start, end: now });
}

export async function fetchMeetingsBooked(range: { start: Date; end: Date }): Promise<number | null> {
  const sheetId = process.env.KPI_SHEET_ID;
  if (!sheetId || !process.env.GOOGLE_SHEETS_CLIENT_ID || !process.env.GOOGLE_SHEETS_REFRESH_TOKEN) {
    return null;
  }
  try {
    const res = await getSheetsClient().spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Meetings!A2:E",
    });
    const rows: string[][] = res.data.values ?? [];
    return countMeetingsInRange(rows, range.start, range.end);
  } catch {
    return null;
  }
}
