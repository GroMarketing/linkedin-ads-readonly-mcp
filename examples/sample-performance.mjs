#!/usr/bin/env node
// Prints the README's sample performance table from made-up numbers (no API call, no account data).
//   node examples/sample-performance.mjs
import { metrics } from '../src/ads.mjs';
import { performanceView } from '../src/format.mjs';

const raw = [
  { id: '500000001', name: 'Ops leaders - lead form', costInLocalCurrency: '2410.75', impressions: 96400, clicks: 538, landingPageClicks: 0, oneClickLeads: 41, oneClickLeadFormOpens: 160 },
  { id: '500000002', name: 'Finance directors - guide', costInLocalCurrency: '1385.20', impressions: 41250, clicks: 310, landingPageClicks: 221, oneClickLeads: 0, externalWebsiteConversions: 9 },
  { id: '500000003', name: 'Retargeting - site visitors', costInLocalCurrency: '402.10', impressions: 18830, clicks: 167, landingPageClicks: 119, oneClickLeads: 6, oneClickLeadFormOpens: 22 },
  { id: '500000004', name: 'Video - brand awareness', costInLocalCurrency: '612.00', impressions: 88100, clicks: 205, landingPageClicks: 48 },
];
const sum = (k) => raw.reduce((s, r) => s + Number(r[k] || 0), 0);
const totals = metrics(Object.fromEntries(['costInLocalCurrency', 'impressions', 'clicks', 'landingPageClicks', 'oneClickLeads', 'oneClickLeadFormOpens', 'externalWebsiteConversions'].map((k) => [k, sum(k)])));
const rows = raw.map((r) => ({ id: r.id, name: r.name, period: null, ...metrics(r) }));
console.log(performanceView({ level: 'campaign', granularity: 'ALL', since: '2026-08-01', until: '2026-08-31', currency: 'USD', rows, totals }));
