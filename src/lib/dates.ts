export interface CalendarDay {
  key: string;
  date: Date;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  hasContent: boolean;
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateFromKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;

  return validLocalDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function monthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" }).toLowerCase();
}

export function shortWeekday(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "short" }).toLowerCase();
}

export function shortDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function calendarDays(anchor: Date, today: Date, contentKeys = new Set<string>(), weekStartsOn: 0 | 1 = 0): CalendarDay[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  start.setDate(first.getDate() - offset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index);
    return {
      key: dateKey(date),
      date,
      day: date.getDate(),
      inMonth: date.getMonth() === anchor.getMonth(),
      isToday: dateKey(date) === dateKey(today),
      hasContent: contentKeys.has(dateKey(date)),
    };
  });
}

const WEEKDAYS: Array<[string, number]> = [
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6],
];

const MONTHS: Array<[string, number]> = [
  ["january", 1],
  ["february", 2],
  ["march", 3],
  ["april", 4],
  ["may", 5],
  ["june", 6],
  ["july", 7],
  ["august", 8],
  ["september", 9],
  ["october", 10],
  ["november", 11],
  ["december", 12],
];

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function matchWeekday(word: string): number | null {
  if (word.length < 3) return null;
  for (const [name, index] of WEEKDAYS) {
    if (name.startsWith(word) || word === name) return index;
  }
  return null;
}

function matchMonth(word: string): number | null {
  if (word.length < 3) return null;
  for (const [name, index] of MONTHS) {
    if (name.startsWith(word)) return index;
  }
  return null;
}

function nearestYearCandidate(month: number, day: number, today: Date): Date | null {
  const year = today.getFullYear();
  // ±4 years so leap-only dates (feb 29) still resolve
  const candidates = [year - 4, year - 3, year - 2, year - 1, year, year + 1, year + 2, year + 3, year + 4]
    .map((candidateYear) => validLocalDate(candidateYear, month, day))
    .filter((date): date is Date => date !== null);

  return candidates.reduce<Date | null>((best, candidate) => {
    if (!best) return candidate;
    return Math.abs(daysBetween(today, candidate)) < Math.abs(daysBetween(today, best)) ? candidate : best;
  }, null);
}

export function parseDateJump(input: string, today = new Date()): Date | null {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/(\d+)(st|nd|rd|th)\b/g, "$1")
    .replace(/[,.]/g, " ")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return null;

  if (value === "today" || value === "now") return startOfLocalDay(today);
  if (value === "tomorrow" || value === "tmr" || value === "tom") return startOfLocalDay(addDays(today, 1));
  if (value === "yesterday") return startOfLocalDay(addDays(today, -1));

  const iso = /^(\d{4})[-/ ](\d{1,2})[-/ ](\d{1,2})$/.exec(value);
  if (iso) {
    return validLocalDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const monthDay = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(value);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    if (monthDay[3]) {
      const rawYear = Number(monthDay[3]);
      const year = rawYear >= 100 ? rawYear : rawYear <= 49 ? 2000 + rawYear : 1900 + rawYear;
      return validLocalDate(year, month, day);
    }
    return nearestYearCandidate(month, day, today);
  }

  // "nov 12", "november 12 2025", "12 november", "12 nov 2025"
  const monthName = /^([a-z]+) (\d{1,2})(?: (\d{4}))?$/.exec(value) ?? null;
  if (monthName) {
    const month = matchMonth(monthName[1]);
    if (month) {
      const day = Number(monthName[2]);
      if (monthName[3]) return validLocalDate(Number(monthName[3]), month, day);
      return nearestYearCandidate(month, day, today);
    }
  }
  const dayMonth = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/.exec(value);
  if (dayMonth) {
    const month = matchMonth(dayMonth[2]);
    if (month) {
      const day = Number(dayMonth[1]);
      if (dayMonth[3]) return validLocalDate(Number(dayMonth[3]), month, day);
      return nearestYearCandidate(month, day, today);
    }
  }

  // "friday" / "next friday" → the upcoming one; "last friday" → the previous one
  const weekdayMatch = /^(?:(next|this|last) )?([a-z]+)$/.exec(value);
  if (weekdayMatch) {
    const weekday = matchWeekday(weekdayMatch[2]);
    if (weekday !== null) {
      const base = startOfLocalDay(today);
      if (weekdayMatch[1] === "last") {
        const back = (base.getDay() - weekday + 7) % 7 || 7;
        return addDays(base, -back);
      }
      const offset = (weekday - base.getDay() + 7) % 7;
      // "this friday" said on a Friday means today; bare/"next" means the upcoming one
      if (offset === 0 && weekdayMatch[1] === "this") return base;
      return addDays(base, offset || 7);
    }
  }

  // "two weeks ago", "3 days ago", "in 2 weeks", "in ten days", "next week", "last month"
  const relative = /^(?:in )?([a-z]+|\d+) (day|week|month)s?(?: (ago|from now))?$/.exec(value);
  if (relative) {
    const count = NUMBER_WORDS[relative[1]] ?? Number(relative[1]);
    if (Number.isFinite(count)) {
      const sign = relative[3] === "ago" ? -1 : 1;
      const shifted = shiftByUnit(startOfLocalDay(today), relative[2], sign * count);
      return Number.isFinite(shifted.getTime()) ? shifted : null;
    }
  }
  const nextLast = /^(next|last) (day|week|month)$/.exec(value);
  if (nextLast) {
    return shiftByUnit(startOfLocalDay(today), nextLast[2], nextLast[1] === "next" ? 1 : -1);
  }

  return null;
}

function shiftByUnit(base: Date, unit: string, count: number): Date {
  if (unit === "day") return addDays(base, count);
  if (unit === "week") return addDays(base, count * 7);
  const next = new Date(base);
  next.setMonth(next.getMonth() + count);
  // month overflow (jan 31 + 1 month) clamps to the target month's last day
  if (next.getDate() !== base.getDate()) next.setDate(0);
  return next;
}

export function daysBetween(base: Date, date: Date): number {
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((end - start) / 86_400_000);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function validLocalDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return date;
}
