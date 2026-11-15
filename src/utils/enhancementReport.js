// The Enhancement report as workbook sheets. Built from the same summarise()
// output the tab shows and the PDF prints. A blank number is an empty cell,
// never 0; percentages are plain numbers (the unit is in the label), not text
// with a % sign. exportToExcel turns null/undefined into an empty cell.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

const NUMBERS = [
  { key: 'productivity', label: 'Productivity', unit: 'kg/h' },
  { key: 'recovery', label: 'Recovery', unit: '%' },
  { key: 'failure', label: 'Failure', unit: '%' },
];

const blank = (v) => (v === null || v === undefined ? '' : v);
const round1 = (v) => (v === null || v === undefined ? '' : Number(v.toFixed(1)));

export const enhancementReportFilename = (from, to, ext) => `Enhancement-Report-${from}-to-${to}.${ext}`;

const SUMMARY_COLUMNS = [
  { key: 'section', label: 'Section' },
  { key: 'measure', label: 'Measure' },
  { key: 'value', label: 'Value' },
  { key: 'unit', label: 'Unit' },
];

function summarySheet({ totals, months, averages }) {
  const rows = [];
  const add = (section, measure, value, unit = '') => rows.push({ section, measure, value: blank(value), unit });

  add('Totals', 'Projects started', totals.started);
  add('Totals', 'Projects completed', totals.completed);
  add('Totals', 'Achieved', totals.achieved);
  add('Totals', 'Partly achieved', totals.partly);
  add('Totals', 'Not achieved', totals.notAchieved);
  add('Totals', 'Success rate', totals.successRate === null ? null : Number((totals.successRate * 100).toFixed(1)), '%');
  add('Totals', 'Awaiting life review', totals.awaitingLifeReview);
  add('Totals', 'Open', totals.open);

  for (const n of NUMBERS) {
    const f = averages[n.key];
    const name = n.label.toLowerCase();
    add('Average change on completed projects', `Average ${name} baseline`, round1(f.baseline), n.unit);
    add('Average change on completed projects', `Average ${name} actual`, round1(f.actual), n.unit);
    add('Average change on completed projects', `Average ${name} change`, round1(f.change), n.unit);
    add('Average change on completed projects', `Projects with both ${name} numbers`, f.count);
  }

  for (const m of months) {
    const label = monthLabel(m.month);
    add('By month', `${label} started`, m.started);
    add('By month', `${label} achieved`, m.achieved);
    add('By month', `${label} partly achieved`, m.partly);
    add('By month', `${label} not achieved`, m.notAchieved);
  }
  return { name: 'Summary', columns: SUMMARY_COLUMNS, rows };
}

const PROJECT_COLUMNS = [
  { key: 'die_no', label: 'Die no' },
  { key: 'profile', label: 'Profile' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'current_issue', label: 'Current issue' },
  ...NUMBERS.flatMap((n) => ['baseline', 'target', 'actual'].map((part) => ({
    key: `${n.key}_${part}`, label: `${n.label} ${part} (${n.unit})`,
  }))),
  { key: 'trial_verdict', label: 'Trial verdict' },
  { key: 'final_verdict', label: 'Final verdict' },
  { key: 'final_verdict_date', label: 'Final verdict date', format: 'date' },
  { key: 'state', label: 'State' },
];

function projectRow(p) {
  const row = {
    die_no: blank(p.die_no), profile: blank(p.profile), supplier: blank(p.supplier), current_issue: blank(p.current_issue),
    trial_verdict: blank(p.trial_verdict), final_verdict: blank(p.final_verdict),
    final_verdict_date: blank(p.final_verdict_date), state: blank(p.state),
  };
  for (const n of NUMBERS) {
    for (const part of ['baseline', 'target', 'actual']) row[`${n.key}_${part}`] = blank(p[n.key][part]);
  }
  return row;
}

// -> [{ name, columns, rows }]; `columns` + `rows` is the shape exportToExcel takes.
export function buildEnhancementSheets(summary) {
  const projects = (name, list) => ({ name, columns: PROJECT_COLUMNS, rows: (list || []).map(projectRow) });
  return [
    summarySheet(summary),
    projects('Completed', summary.completed),
    projects('Started', summary.started),
    projects('Open', summary.open),
  ];
}
