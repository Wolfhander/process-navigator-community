import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleCsv, scheduleCsvCell } from '../src/schedule-export.ts';
test('CSV treats spreadsheet formula prefixes as text', () => {
  for (const value of ['=1+1', '+cmd', '-danger', '@name', '  =1']) assert.ok(scheduleCsvCell(value).startsWith('"\''));
  assert.equal(scheduleCsvCell('чертёж "А"'), '"чертёж ""А"""');
});
test('export includes actual per-process calendar and original source version', () => {
  const result = { anchorDate: '2026-10-19T06:00Z', direction: 'Forward', assumptions: { workdayStart: '09:00', workdayEnd: '17:00', workingDays: [1], nonWorkingDates: [], utcOffsetMinutes: 180, durationScalePercent: 100, transferDelayHours: 2, includeWaitTime: true,
    processCalendars: { p: { workdayStart: '10:00', workdayEnd: '18:00', workingDays: [2], nonWorkingDates: ['2026-10-20'], utcOffsetMinutes: 300 } } },
    sources: { algorithm: 'schedule-v2-fixed-offset', processes: [{ id: 'p', version: 'version-7', status: 'Published' }] },
    processes: [{ processId: 'p', processName: 'Процесс', startAt: '2026-10-21T05:00Z', endAt: '2026-10-21T13:00Z', durationHours: 8, isDateReliable: false, uncertaintyReasons: ['Нет входа'], slackHours: 0 }] };
  const csv = scheduleCsv(result);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"10:00";"18:00";"300";"2";"2026-10-20";"version-7";"Published"'));
  assert.ok(csv.includes('schedule-v2-fixed-offset'));
  assert.ok(csv.includes('Нет входа'));
});
test('CSV includes chosen outcomes, bounded passes and upper dates', () => {
  const result = { anchorDate: '2026-10-19T06:00Z', direction: 'Forward', assumptions: { workdayStart: '09:00', workdayEnd: '17:00', workingDays: [1], nonWorkingDates: [], durationScalePercent: 100, transferDelayHours: 0, includeWaitTime: true,
    processBranches: { p: { g: 'choice' } }, processRepetitions: { p: { returnEdgeId: 'back-edge', plannedRepeats: 1, maximumRepeats: 3 } } },
    processes: [{ processId: 'p', processName: 'Процесс', startAt: '2026-10-19T06:00Z', endAt: '2026-10-19T14:00Z', durationHours: 8, maximumDurationHours: 16, maximumStartAt: '2026-10-19T06:00Z', maximumEndAt: '2026-10-20T14:00Z', isDateReliable: true, uncertaintyReasons: [], slackHours: 0 }] };
  const csv = scheduleCsv(result);
  assert.ok(csv.includes('"back-edge";"1";"3"'));
  assert.ok(csv.includes('choice'));
  assert.ok(csv.includes('2026-10-20T14:00Z'));
});
