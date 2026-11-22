/*
 * Birthday dates (src/birthday.js): milestones, anniversaries, Feb 29,
 * once per day, no fake anniversary for a migrated install date.
 *   node test/birthday.test.js
 */
globalThis.Mochi = {};
const B = require('../src/birthday.js');
let fails = 0, n = 0;
const eq = (got, want, name) => {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.error(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const plan = (installDate, today, extra = {}) => B.plan({ installDate, today, ...extra });
const kind = p => (p.celebrate ? `${p.celebrate.kind}:${p.celebrate.id}` : null);

// dates
eq(B.addDays('2025-12-28', 7), '2026-01-04', 'addDays over the new year');
eq(B.addMonths('2025-01-31', 1), '2025-02-28', 'one month after Jan 31 = Feb 28');
eq(B.addMonths('2024-01-31', 1), '2024-02-29', 'one month after Jan 31 in a leap year = Feb 29');
eq(B.addMonths('2025-12-15', 1), '2026-01-15', 'one month over the new year');
eq(B.anniversaryIn('2024-02-29', 2025), '2025-02-28', 'Feb 29 → Feb 28 in a common year');
eq(B.anniversaryIn('2024-02-29', 2028), '2028-02-29', 'Feb 29 stays in a leap year');
eq(B.isLeap(1900) || !B.isLeap(2000), false, 'century leap rule');

// milestones
eq(kind(plan('2026-03-01', '2026-03-07')), null, '6 days: nothing');
eq(kind(plan('2026-03-01', '2026-03-08')), 'milestone:d7', '7 days');
eq(plan('2026-03-01', '2026-03-08').mark, ['d7'], '7 days is marked');
eq(kind(plan('2026-03-01', '2026-03-08', { celebrated: ['d7'] })), null, '7 days only once');
eq(kind(plan('2026-03-01', '2026-03-12')), 'milestone:d7', '7 days, seen 4 days late: still celebrated');
eq(kind(plan('2026-01-31', '2026-02-28')), 'milestone:m1', '1 month from Jan 31 = Feb 28');
eq(kind(plan('2026-03-01', '2026-04-01', { celebrated: ['d7'] })), 'milestone:m1', '1 month');
eq(kind(plan('2026-03-01', '2026-06-09', { celebrated: ['d7', 'm1'] })), 'milestone:d100', '100 days');
const late = plan('2026-03-01', '2026-06-20');
eq([kind(late), late.mark], [null, ['d7', 'm1', 'd100']], 'first visit after all milestones, too late: no party, all marked');
const two = plan('2026-03-01', '2026-04-03');
eq([kind(two), two.mark], ['milestone:m1', ['d7', 'm1']], 'missed the week, back for the month: one party, both marked');

// anniversaries
eq(kind(plan('2025-11-22', '2026-11-22', { celebrated: ['d7', 'm1', 'd100'] })), 'anniversary:y1', '1st birthday');
eq(plan('2025-11-22', '2026-11-22').celebrate?.years, 1, 'years = 1');
eq(kind(plan('2023-11-22', '2026-11-22', { celebrated: ['d7', 'm1', 'd100', 'y1', 'y2'] })), 'anniversary:y3', '3rd birthday');
eq(kind(plan('2025-11-22', '2026-11-23', { celebrated: ['d7', 'm1', 'd100'] })), null, 'the day after: nothing');
eq(plan('2025-11-22', '2026-11-22').birthday, 1, 'birthday flag on the day');
eq(plan('2025-11-22', '2026-11-21').birthday, 0, 'no birthday flag the day before');
eq(kind(plan('2025-11-22', '2025-11-22')), null, 'install day itself is not a birthday');
eq(kind(plan('2024-02-29', '2025-02-28', { celebrated: ['d7', 'm1', 'd100'] })), 'anniversary:y1', 'Feb 29 install → party on Feb 28, 2025');
eq(kind(plan('2024-02-29', '2025-03-01', { celebrated: ['d7', 'm1', 'd100'] })), null, '… and not on Mar 1');
eq(kind(plan('2024-02-29', '2028-02-29', { celebrated: ['d7', 'm1', 'd100', 'y1', 'y2', 'y3'] })), 'anniversary:y4', 'Feb 29 in a leap year');
eq(kind(plan('2024-02-29', '2028-02-28', { celebrated: ['d7', 'm1', 'd100', 'y1', 'y2', 'y3'] })), null, '… not Feb 28 when there is a Feb 29');

// once per day, across tabs
eq(kind(plan('2025-11-22', '2026-11-22', { lastCelebrated: '2026-11-22' })), null, 'already celebrated today (another tab)');
eq(plan('2025-11-22', '2026-11-22', { lastCelebrated: '2026-11-22' }).birthday, 1, '… the hat stays on all day');
eq(kind(plan('2025-11-22', '2026-11-22', { celebrated: ['d7', 'm1', 'd100', 'y1'] })), null, 'birthday already celebrated');

// no fake anniversary
eq(plan('2025-11-22', '2026-11-22', { installMigrated: true }), { birthday: 0, celebrate: null, mark: [] }, 'migrated install date: nothing');
eq(plan('2026-03-01', '2026-03-08', { installMigrated: true }).celebrate, null, 'migrated: no milestones either');
eq(plan(undefined, '2026-03-08').celebrate, null, 'no install date');
eq(plan('2026-03-10', '2026-03-08').celebrate, null, 'clock before the install day');

if (fails) { console.error(`${fails} of ${n} failed`); process.exit(1); }
console.log(`ok   birthday dates: ${n} checks`);
