#!/usr/bin/env node
// Prints the README's sample demographics table from made-up numbers (no API call, no account data).
//   node examples/sample-demographics.mjs
import { metrics } from '../src/ads.mjs';
import { demographicsView } from '../src/format.mjs';

const total = metrics({ costInLocalCurrency: '4810.05', impressions: 244580, clicks: 1220, landingPageClicks: 388, oneClickLeads: 47 });
const raw = [
  ['Operations Manager', 31200, 214, '701.40', 61, 9],
  ['Chief Financial Officer', 22950, 96, '512.85', 40, 6],
  ['Controller', 18410, 120, '398.20', 37, 5],
  ['Director of Operations', 15300, 88, '341.10', 22, 4],
  ['Finance Manager', 9870, 41, '207.60', 12, 1],
];
const rows = raw.map(([value, impressions, clicks, cost, lp, leads]) => {
  const m = metrics({ impressions, clicks, costInLocalCurrency: cost, landingPageClicks: lp, oneClickLeads: leads });
  return { value, urn: '', ...m, share: Math.round((impressions / total.impressions) * 1000) / 10 };
});
console.log(demographicsView({
  pivot: 'MEMBER_JOB_TITLE', since: '2026-08-01', until: '2026-08-31', currency: 'USD', total, returned: 214, rows,
  notes: [
    'LinkedIn leaves out values with very small counts to protect member privacy. A value that is missing here is withheld or had no delivery; it is not zero.',
    'Members can match several values (more than one title, industry or company), so rows can add up to more than the total. Read each row as a share of all impressions; do not sum them.',
  ],
}));
