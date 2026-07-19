import type { GainerMarket } from '../types/marketGainers.ts';

const MARKET_TIMEZONE: Record<GainerMarket, string> = {
  US: 'America/New_York',
  CN: 'Asia/Shanghai',
  HK: 'Asia/Hong_Kong',
};

/** Regular session close in market local time (minutes from midnight). */
const MARKET_CLOSE_MINUTE: Record<GainerMarket, number> = {
  US: 16 * 60,
  CN: 15 * 60,
  HK: 16 * 60,
};

const ISO_DATE = (date: Date): string => date.toISOString().slice(0, 10);

/** Minimal holiday sets (extend annually). Weekends always closed. */
const US_HOLIDAYS = new Set([
  '2025-01-01',
  '2025-01-20',
  '2025-02-17',
  '2025-04-18',
  '2025-05-26',
  '2025-06-19',
  '2025-07-04',
  '2025-09-01',
  '2025-11-27',
  '2025-12-25',
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
]);

const CN_HOLIDAYS = new Set([
  '2025-01-01',
  '2025-01-28',
  '2025-01-29',
  '2025-01-30',
  '2025-01-31',
  '2025-02-01',
  '2025-02-02',
  '2025-02-03',
  '2025-02-04',
  '2025-04-04',
  '2025-04-05',
  '2025-04-06',
  '2025-05-01',
  '2025-05-02',
  '2025-05-03',
  '2025-05-04',
  '2025-05-05',
  '2025-05-31',
  '2025-06-01',
  '2025-06-02',
  '2025-10-01',
  '2025-10-02',
  '2025-10-03',
  '2025-10-04',
  '2025-10-05',
  '2025-10-06',
  '2025-10-07',
  '2025-10-08',
  '2026-01-01',
  '2026-01-02',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-02-20',
  '2026-02-21',
  '2026-02-22',
  '2026-02-23',
  '2026-04-05',
  '2026-04-06',
  '2026-04-07',
  '2026-05-01',
  '2026-05-02',
  '2026-05-03',
  '2026-05-04',
  '2026-05-05',
  '2026-06-19',
  '2026-06-20',
  '2026-06-21',
  '2026-09-25',
  '2026-09-26',
  '2026-09-27',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
]);

const holidaySetForMarket = (market: GainerMarket): Set<string> => {
  if (market === 'CN') return CN_HOLIDAYS;
  return US_HOLIDAYS;
};

const timezoneForMarket = (market: GainerMarket): string =>
  MARKET_TIMEZONE[market] ?? MARKET_TIMEZONE.US;

export const isoDateInTimeZone = (date: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

const weekdayInTimeZone = (date: Date, timeZone: string): number => {
  const label = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[label] ?? 0;
};

const minutesSinceMidnightInTimeZone = (date: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
};

const dateFromIsoUtcNoon = (iso: string): Date => new Date(`${iso}T12:00:00.000Z`);

export const isTradingDay = (market: GainerMarket, date: Date): boolean => {
  const timeZone = timezoneForMarket(market);
  const iso = isoDateInTimeZone(date, timeZone);
  const day = weekdayInTimeZone(date, timeZone);
  if (day === 0 || day === 6) return false;
  return !holidaySetForMarket(market).has(iso);
};

export const shiftCalendarDays = (date: Date, delta: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
};

/**
 * Last fully completed regular session for the market, using local market timezone
 * and regular close time (US 16:00 ET, CN 15:00 CST).
 */
export const getLastCompletedTradingDay = (market: GainerMarket, now = new Date()): string => {
  const timeZone = timezoneForMarket(market);
  const todayIso = isoDateInTimeZone(now, timeZone);
  const todayDate = dateFromIsoUtcNoon(todayIso);
  const closeMinute = MARKET_CLOSE_MINUTE[market] ?? MARKET_CLOSE_MINUTE.US;
  const nowMinute = minutesSinceMidnightInTimeZone(now, timeZone);

  if (isTradingDay(market, todayDate) && nowMinute >= closeMinute) {
    return todayIso;
  }

  let cursor = shiftCalendarDays(todayDate, -1);
  while (!isTradingDay(market, cursor)) {
    cursor = shiftCalendarDays(cursor, -1);
  }
  return isoDateInTimeZone(cursor, timeZone);
};

/** @deprecated Prefer getLastCompletedTradingDay — kept for callers expecting this name. */
export const getPreviousTradingDay = (market: GainerMarket, from = new Date()): string =>
  getLastCompletedTradingDay(market, from);

export const getTradingDaysBefore = (
  market: GainerMarket,
  endDateIso: string,
  count: number
): string[] => {
  const days: string[] = [];
  let cursor = dateFromIsoUtcNoon(endDateIso);
  while (days.length < count) {
    if (isTradingDay(market, cursor)) {
      days.unshift(isoDateInTimeZone(cursor, timezoneForMarket(market)));
    }
    cursor = shiftCalendarDays(cursor, -1);
  }
  return days;
};

/** Last trading day of the ISO week containing `from` (Mon–Sun, market timezone). */
export const getLastTradingDayOfWeek = (market: GainerMarket, from = new Date()): string => {
  const timeZone = timezoneForMarket(market);
  const todayIso = isoDateInTimeZone(from, timeZone);
  const cursor = dateFromIsoUtcNoon(todayIso);
  const day = weekdayInTimeZone(from, timeZone);
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  cursor.setUTCDate(cursor.getUTCDate() + daysUntilSunday);

  while (!isTradingDay(market, cursor)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return isoDateInTimeZone(cursor, timeZone);
};

/** First trading day of the week ending at `weekEndIso`. */
export const getFirstTradingDayOfWeek = (
  market: GainerMarket,
  weekEndIso: string
): string => {
  const end = dateFromIsoUtcNoon(weekEndIso);
  const start = shiftCalendarDays(end, -6);
  let cursor = start;
  while (cursor <= end) {
    if (isTradingDay(market, cursor)) {
      return isoDateInTimeZone(cursor, timezoneForMarket(market));
    }
    cursor = shiftCalendarDays(cursor, 1);
  }
  return weekEndIso;
};

export const shouldRunDailyRefresh = (market: GainerMarket, now = new Date()): boolean => {
  const timeZone = timezoneForMarket(market);
  const today = dateFromIsoUtcNoon(isoDateInTimeZone(now, timeZone));
  return isTradingDay(market, today);
};

export const shouldRunWeeklyRefresh = (market: GainerMarket, now = new Date()): boolean => {
  const weekEnd = getLastTradingDayOfWeek(market, now);
  return isoDateInTimeZone(now, timezoneForMarket(market)) === weekEnd;
};
