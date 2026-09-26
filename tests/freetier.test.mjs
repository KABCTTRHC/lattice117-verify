/**
 * Free-tier depth caps.
 *
 * Only the pure logic is tested here. The quota is browser storage and is
 * exercised in the headless harness; these are the parts that decide what a
 * free user is actually shown, so they are the parts worth pinning.
 */
import { capRoutes, capRotaRows, splitBreaches, LIMITS } from '../demo/freetier.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
};
const route = (v, n) => ({ vehicle: v, stops: Array.from({ length: n }, (_, i) => ({ id: `${v}${i}` })) });

console.log('\nFleet depth cap (1 round, 6 stops)');
{
  const c = capRoutes([route('A', 10), route('B', 3), route('C', 4)]);
  eq('keeps one round', c.routes.map(r => r.vehicle), ['A']);
  eq('keeps six stops', c.routes[0].stops.length, 6);
  eq('reports 2 rounds and 4 stops withheld', c.hidden, { rounds: 2, stops: 4 });
}
{
  const c = capRoutes([route('A', 4)]);
  eq('a small single round is untouched', [c.routes[0].stops.length, c.hidden], [4, { rounds: 0, stops: 0 }]);
}
{
  const c = capRoutes([route('A', 6)]);
  eq('exactly six stops withholds nothing', c.hidden, { rounds: 0, stops: 0 });
}
eq('an empty fleet does not throw', capRoutes([]).hidden, { rounds: 0, stops: 0 });

console.log('\nRota depth cap (1 person, 4 shifts)');
{
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => ({ staff: 'Alice', row: i + 2 })),
    { staff: 'Bob', row: 8 }, { staff: 'Cara', row: 9 },
  ];
  const c = capRotaRows(rows);
  eq('keeps one person', [...new Set(c.rows.map(r => r.staff))], ['Alice']);
  eq('keeps four shifts', c.rows.length, 4);
  eq('reports 2 people and 2 shifts withheld', c.hidden, { people: 2, shifts: 2 });
  eq('preserves original row numbers', c.rows.map(r => r.row), [2, 3, 4, 5]);
}
{
  // Interleaved rows are the realistic case: a rota is usually sorted by date,
  // not grouped by person, so the first person seen must still be the one kept.
  const rows = [
    { staff: 'Zoe', row: 2 }, { staff: 'Yann', row: 3 },
    { staff: 'Zoe', row: 4 }, { staff: 'Yann', row: 5 }, { staff: 'Zoe', row: 6 },
  ];
  const c = capRotaRows(rows);
  eq('interleaved: keeps the first person seen', c.rows.map(r => r.row), [2, 4, 6]);
  eq('interleaved: reports 1 person withheld', c.hidden, { people: 1, shifts: 0 });
}
eq('blank staff names are ignored', capRotaRows([{ staff: '  ' }, { staff: 'A' }]).rows.length, 1);

console.log('\nBreach preview');
eq('one breach is shown whole, none masked', splitBreaches(['a']), { shown: ['a'], hiddenCount: 0 });
eq('four breaches show one and mask three', splitBreaches(['a','b','c','d']), { shown: ['a'], hiddenCount: 3 });
eq('no breaches masks nothing', splitBreaches([]), { shown: [], hiddenCount: 0 });

console.log('\nLimits are the documented ones');
eq('1 round / 6 stops / 1 person / 4 shifts / 3 imports',
   [LIMITS.routeRounds, LIMITS.routeStops, LIMITS.rotaPeople, LIMITS.rotaShifts, LIMITS.imports],
   [1, 6, 1, 4, 3]);
eq('window is 24 hours', LIMITS.windowMs, 86400000);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
