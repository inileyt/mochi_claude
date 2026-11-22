/*
 * Mochi — birthday dates (pure functions, no page or storage access).
 *
 * Counted from mochi.meta.installDate ('YYYY-MM-DD', the day Mochi was
 * installed) and today's local date:
 *   - milestones: 7 days, 1 month (same day next month, or that month's last
 *     day), 100 days. Each is celebrated once; if you weren't around on the
 *     day, it's still celebrated within a week, later ones are just marked.
 *   - anniversaries: every year on the install day. Installed on Feb 29?
 *     Then Feb 28 in years without a Feb 29.
 *   - at most one celebration per day (lastCelebrated), across tabs.
 *   - an installDate made up during the 1.x → 1.26 migration isn't a real
 *     install day: no celebrations for it (no fake anniversary).
 * src/birthday-party.js does the celebrating. Tests: test/birthday.test.js.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});

  const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
  const fmt = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayNumber = s => { const p = parse(s); return Date.UTC(p.y, p.m - 1, p.d) / 864e5; };
  const addDays = (s, n) => { const p = parse(s); const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  const addMonths = (s, n) => {
    const p = parse(s);
    const total = p.y * 12 + (p.m - 1) + n;
    const y = Math.floor(total / 12), m = (total % 12) + 1;
    return fmt(y, m, Math.min(p.d, daysIn(y, m)));
  };
  /** The install day's anniversary in a given year (Feb 29 → Feb 28 in other years). */
  const anniversaryIn = (installDate, year) => {
    const p = parse(installDate);
    const d = p.m === 2 && p.d === 29 && !isLeap(year) ? 28 : p.d;
    return fmt(year, p.m, d);
  };

  const MILESTONES = [
    { id: 'd7', at: d => addDays(d, 7) },
    { id: 'm1', at: d => addMonths(d, 1) },
    { id: 'd100', at: d => addDays(d, 100) },
  ];
  const LATE_DAYS = 6; // a milestone you missed is still celebrated this many days later

  /** How many years old Mochi turns today (0 if today isn't the birthday). */
  function yearsToday(installDate, today) {
    const i = parse(installDate), t = parse(today);
    if (!i || !t || t.y <= i.y) return 0;
    return anniversaryIn(installDate, t.y) === today ? t.y - i.y : 0;
  }

  /**
   * What to do today.
   * → { birthday: n (0 if not), celebrate: null | { kind: 'anniversary', id: 'y1', years }
   *     | { kind: 'milestone', id: 'd7' | 'm1' | 'd100' }, mark: ids to save as done }
   */
  function plan({ installDate, installMigrated = false, today, celebrated = [], lastCelebrated = null } = {}) {
    const none = { birthday: 0, celebrate: null, mark: [] };
    if (!parse(installDate) || !parse(today) || installMigrated) return none;
    if (dayNumber(today) < dayNumber(installDate)) return none; // a clock set back
    const done = new Set(celebrated);
    const birthday = yearsToday(installDate, today);
    // Milestones that are due (and not done), oldest first.
    const due = MILESTONES.map(m => ({ id: m.id, date: m.at(installDate) })).filter(m => !done.has(m.id) && m.date <= today);
    const mark = due.map(m => m.id);
    if (lastCelebrated === today) return { birthday, celebrate: null, mark: [] }; // already partied today (another tab)
    if (birthday && !done.has(`y${birthday}`)) return { birthday, celebrate: { kind: 'anniversary', id: `y${birthday}`, years: birthday }, mark: [...mark, `y${birthday}`] };
    const latest = due.at(-1);
    if (latest && dayNumber(today) - dayNumber(latest.date) <= LATE_DAYS) return { birthday, celebrate: { kind: 'milestone', id: latest.id }, mark };
    return { birthday, celebrate: null, mark }; // too late to party: just remember them
  }

  Mochi.birthdayDates = { parse, fmt, isLeap, addDays, addMonths, anniversaryIn, yearsToday, plan, MILESTONES, LATE_DAYS };
  if (typeof module !== 'undefined') module.exports = Mochi.birthdayDates;
})();
