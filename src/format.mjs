// Plain-text views, readable in a terminal and in an MCP client.

const num = (n) => (n == null ? '' : Number(n).toLocaleString('en-US'));
const money = (n) => (n == null ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (n, d = 2) => (n == null ? '' : `${Number(n).toFixed(d)}%`);
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return [...t].length > n ? `${[...t].slice(0, n - 1).join('')}…` : t;
};
const when = (r) => (r.start || r.end ? `${r.start || '?'} to ${r.end || 'open'}` : '');

/** Aligned table. cols: [heading, (row) => cell, 'l' | 'r']. Text columns pad right, numbers pad left. */
export function table(rows, cols, { header = '', footer = [] } = {}) {
  const cells = rows.map((r) => cols.map(([, f]) => String(f(r) ?? '')));
  const width = cols.map(([h], i) => Math.max([...h].length, ...cells.map((c) => [...c[i]].length)));
  const line = (c) => c.map((x, i) => (cols[i][2] === 'r' ? x.padStart(width[i]) : x.padEnd(width[i]))).join('  ').trimEnd();
  const out = [];
  if (header) out.push(header, '');
  if (!rows.length) out.push('(none)');
  else {
    out.push(line(cols.map(([h]) => h)));
    for (const c of cells) out.push(line(c));
  }
  const notes = footer.filter(Boolean);
  if (notes.length) out.push('', ...notes);
  return out.join('\n');
}

export function csv(rows) {
  if (!rows.length) return '';
  const flat = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v && typeof v === 'object' ? (Array.isArray(v) ? v.join(';') : v.text ?? JSON.stringify(v)) : v])));
  const head = [...new Set(flat.flatMap(Object.keys))];
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [head.join(','), ...flat.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n');
}

export const accountsView = (rows) =>
  table(rows, [
    ['id', (r) => r.id, 'r'],
    ['name', (r) => clip(r.name, 40)],
    ['currency', (r) => r.currency],
    ['status', (r) => r.status],
    ['serving', (r) => r.servingStatuses.join(', ')],
    ['type', (r) => `${r.type || ''}${r.test ? ' (test)' : ''}`],
  ], { header: `Ad accounts this token can read (${rows.length})` });

export const groupsView = (rows) =>
  table(rows, [
    ['id', (r) => r.id, 'r'],
    ['name', (r) => clip(r.name, 40)],
    ['status', (r) => r.status],
    ['objective', (r) => r.objective || ''],
    ['total budget', (r) => money(r.totalBudget), 'r'],
    ['schedule', when],
  ], { header: `Campaign groups (${rows.length})` });

export const campaignsView = (rows) =>
  table(rows, [
    ['id', (r) => r.id, 'r'],
    ['name', (r) => clip(r.name, 36)],
    ['group', (r) => clip(r.groupName || r.groupId, 24)],
    ['status', (r) => r.status],
    ['objective', (r) => r.objective || ''],
    ['bid', (r) => r.bid.text],
    ['daily', (r) => money(r.dailyBudget), 'r'],
    ['total', (r) => money(r.totalBudget), 'r'],
    ['schedule', when],
  ], {
    header: `Campaigns (${rows.length})`,
    footer: [rows.some((r) => r.bid.strategy === 'none') && '"no bid set": no optimization target and no unit cost. Such a campaign can show ACTIVE and still not win auctions.'],
  });

const PERF_COLS = (level) => [
  ...(level === 'account' ? [] : [['id', (r) => r.id ?? '', 'r']]),
  ['name', (r) => clip(r.name ?? (r.id ? `(${level} ${r.id})` : ''), 34)],
  ...(level === 'creative' ? [['campaign', (r) => clip(r.campaign, 24)]] : []),
  ['spend', (r) => money(r.spend), 'r'],
  ['impr', (r) => num(r.impressions), 'r'],
  ['clicks', (r) => num(r.clicks), 'r'],
  ['lp clicks', (r) => num(r.landingPageClicks), 'r'],
  ['ctr', (r) => pct(r.ctr), 'r'],
  ['cpc', (r) => money(r.cpc), 'r'],
  ['cpm', (r) => money(r.cpm), 'r'],
  ['leads', (r) => num(r.leads), 'r'],
  ['cpl', (r) => money(r.cpl), 'r'],
  ['conv', (r) => num(r.conversions), 'r'],
];

export function performanceView(p) {
  const byPeriod = p.granularity !== 'ALL';
  const cols = [...(byPeriod ? [['period', (r) => r.period]] : []), ...PERF_COLS(p.level)];
  const rows = !byPeriod && p.rows.length > 1 ? [...p.rows, { name: 'total', ...p.totals }] : p.rows;
  return table(rows, cols, {
    header: `Performance by ${p.level}, ${p.since} to ${p.until}${byPeriod ? `, ${p.granularity.toLowerCase()}` : ''}${p.currency ? ` (spend in ${p.currency})` : ''}`,
    footer: [
      `clicks counts every click on the ad (profile, expand, play). lp clicks are clicks to your landing page. leads are lead gen form submissions; conv are website conversions.`,
      p.rows.length ? `Only ${p.level === 'account' ? 'periods' : `${p.level}s`} with delivery in the range are listed.` : 'No delivery in this range.',
    ],
  });
}

export function demographicsView(d) {
  const label = d.pivot.replace(/^MEMBER_/, '').replace(/_V2$/, '').toLowerCase().replace(/_/g, ' ');
  return table(d.rows, [
    [label, (r) => clip(r.value ?? `${r.urn} (unresolved)`, 40)],
    ['impr', (r) => num(r.impressions), 'r'],
    ['share', (r) => pct(r.share, 1), 'r'],
    ['clicks', (r) => num(r.clicks), 'r'],
    ['ctr', (r) => pct(r.ctr), 'r'],
    ['spend', (r) => money(r.spend), 'r'],
    ['lp clicks', (r) => num(r.landingPageClicks), 'r'],
    ['leads', (r) => num(r.leads), 'r'],
  ], {
    header: `Delivery by ${label}, ${d.since} to ${d.until}: ${num(d.total.impressions)} impressions in total${d.currency ? ` (spend in ${d.currency})` : ''}`,
    footer: [d.returned > d.rows.length && `Top ${d.rows.length} of ${d.returned} values by impressions.`, ...d.notes],
  });
}

export function creativesView(c) {
  return table(c.rows, [
    ['id', (r) => r.id, 'r'],
    ['campaign', (r) => r.campaignId, 'r'],
    ['status', (r) => `${r.status || ''}${r.review ? `/${r.review}` : ''}${r.serving ? ' serving' : ''}`],
    ['format', (r) => r.format || ''],
    ['text', (r) => clip(r.title ? `${r.title}: ${r.text || ''}` : r.text || r.note || '', 50)],
    ['cta', (r) => r.cta || ''],
    ['destination', (r) => (r.leadForm ? `lead form ${r.leadForm}` : clip(r.landingPage || '', 40))],
  ], {
    header: `Creatives (${c.rows.length}${c.total > c.rows.length ? ` of ${c.total}` : ''})`,
    footer: [c.total > c.rows.length && `Showing the first ${c.rows.length}. Filter by campaign or raise the limit for more.`, c.rows.length && 'Full post text is in --json.'],
  });
}

export function formsView(f) {
  return table(f.rows, [
    ['id', (r) => r.id, 'r'],
    ['name', (r) => clip(r.name || '(not listed)', 36)],
    ['state', (r) => `${r.state || ''}${r.review ? `/${r.review}` : ''}`],
    ['fields', (r) => r.fields.length || '', 'r'],
    ['opens', (r) => num(r.formOpens), 'r'],
    ['leads', (r) => num(r.leads), 'r'],
    ['completion', (r) => pct(r.completionRate, 1), 'r'],
    ['cpl', (r) => money(r.cpl), 'r'],
  ], {
    header: `Lead gen forms, leads ${f.since} to ${f.until}`,
    footer: [f.warning, 'Counts only. Lead names, emails and answers are never fetched.'],
  });
}

export function targetingView(t) {
  const vals = (b) => `${b.facet}: ${b.values.map((v) => v.name || `${v.urn} (unresolved)`).join(' OR ')}`;
  const out = [`Targeting for campaign ${t.campaign.id}${t.campaign.name ? ` (${t.campaign.name})` : ''}, ${t.campaign.status}`, ''];
  if (!t.include.length) out.push('include: (none)');
  t.include.forEach((clause, i) => out.push(`${i ? 'AND ' : ''}${clause.map(vals).join('  OR  ')}`));
  if (t.exclude.length) out.push('', 'EXCLUDE', ...t.exclude.map(vals));
  out.push('', `audience expansion: ${t.campaign.audienceExpansion ? 'on' : 'off'}, LinkedIn Audience Network: ${t.campaign.offsiteDelivery ? 'on' : 'off'}`);
  return out.join('\n');
}

export const entitiesView = (rows, header = '') => table(rows, [['urn', (r) => r.urn], ['name', (r) => r.name ?? '(not found)']], { header });
