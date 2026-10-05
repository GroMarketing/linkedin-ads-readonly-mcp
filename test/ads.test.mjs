// Offline tests: every API response is synthetic. No credentials, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listAccounts, listCampaignGroups, listCampaigns, performance, demographics, listCreatives, leadForms,
  resolveUrns, searchTargeting, campaignTargeting, describeBid, metrics, dateWindow, pivotName, companySizeLabel,
  accountId, numericId, STATUSES, performanceView, demographicsView, campaignsView, creativesView, formsView, targetingView, csv, redact,
} from '../src/index.mjs';

const TOKEN = 'AQtest-token-0000000000000000000000000000000000000000';
Object.assign(process.env, { LINKEDIN_ACCESS_TOKEN: TOKEN, LINKEDIN_AD_ACCOUNT_ID: '123456789' });
delete process.env.LINKEDIN_API_VERSION;

/** routes: [[RegExp, body | (url) => body], ...]. A body with __status is an error response. */
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const hit = routes.find(([re]) => re.test(decodeURIComponent(u)));
    if (!hit) throw new Error(`unrouted ${u}`);
    const b = typeof hit[1] === 'function' ? hit[1](decodeURIComponent(u)) : hit[1];
    return { ok: !b?.__status, status: b?.__status || 200, text: async () => (typeof b === 'string' ? b : JSON.stringify(b)) };
  };
  fn.calls = calls;
  return fn;
}

const ACCOUNT = { id: 123456789, name: 'Example Co Ads', currency: 'USD', status: 'ACTIVE', type: 'BUSINESS', servingStatuses: ['RUNNABLE'], test: false };
const GROUPS = { elements: [{ id: 600000001, name: 'Q3 Pipeline', status: 'ACTIVE', objectiveType: 'LEAD_GENERATION', totalBudget: { amount: '5000', currencyCode: 'USD' }, runSchedule: { start: Date.UTC(2026, 6, 1), end: Date.UTC(2026, 8, 30) } }] };
const CAMPAIGNS = {
  elements: [
    { id: 500000001, name: 'Ops leaders - lead form', campaignGroup: 'urn:li:sponsoredCampaignGroup:600000001', status: 'ACTIVE', objectiveType: 'LEAD_GENERATION', costType: 'CPM', optimizationTargetType: 'MAX_LEAD', dailyBudget: { amount: '80', currencyCode: 'USD' }, runSchedule: { start: Date.UTC(2026, 6, 1) } },
    { id: 500000002, name: 'Site visits - finance', campaignGroup: 'urn:li:sponsoredCampaignGroup:600000001', status: 'PAUSED', objectiveType: 'WEBSITE_VISIT', costType: 'CPC', optimizationTargetType: 'NONE', unitCost: { amount: '6.5', currencyCode: 'USD' }, dailyBudget: { amount: '40', currencyCode: 'USD' } },
  ],
};
const dr = { start: { year: 2026, month: 7, day: 1 }, end: { year: 2026, month: 7, day: 31 } };
const row = (urn, o) => ({ pivotValues: [urn], dateRange: dr, ...o });
const ANALYTICS = {
  elements: [
    row('urn:li:sponsoredCampaign:500000002', { costInLocalCurrency: '300.00', impressions: 20000, clicks: 100, landingPageClicks: 60, oneClickLeads: 0, externalWebsiteConversions: 3 }),
    row('urn:li:sponsoredCampaign:500000001', { costInLocalCurrency: '1200.50', impressions: 50000, clicks: 250, landingPageClicks: 0, oneClickLeads: 20, oneClickLeadFormOpens: 80 }),
  ],
};
const base = [
  [/adAccounts\/123456789\/adCampaigns\?q=search/, CAMPAIGNS],
  [/adAccounts\/123456789\/adCampaignGroups\?q=search/, GROUPS],
  [/adAccounts\/123456789$/, ACCOUNT],
];

test('credentials ride in headers only, every request is a GET, and the default version is 202609', async () => {
  const f = mockFetch([[/adAnalytics/, ANALYTICS], ...base]);
  await performance({ since: '2026-07-01', until: '2026-07-31', fetchImpl: f });
  assert.ok(f.calls.length >= 3);
  for (const c of f.calls) {
    assert.ok(!c.url.includes(TOKEN), 'token must not appear in a URL');
    assert.equal(c.init.method, 'GET');
    assert.equal(c.init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(c.init.headers['LinkedIn-Version'], '202609');
    assert.equal(c.init.headers['X-Restli-Protocol-Version'], '2.0.0');
  }
  process.env.LINKEDIN_API_VERSION = '202607';
  const g = mockFetch(base);
  await listCampaignGroups({ fetchImpl: g });
  assert.equal(g.calls[0].init.headers['LinkedIn-Version'], '202607');
  delete process.env.LINKEDIN_API_VERSION;
});

test('a retired API version, an expired token and a missing scope each get a plain explanation, with the token scrubbed', async () => {
  const f = mockFetch([[/./, { __status: 426, code: 'NONEXISTENT_VERSION', message: 'Requested version 20250901 is not active' }]]);
  await assert.rejects(listCampaignGroups({ fetchImpl: f }), /no longer serves API version 202609.*LINKEDIN_API_VERSION/s);
  const g = mockFetch([[/./, { __status: 401, message: `Invalid access token ${TOKEN}` }]]);
  await assert.rejects(listCampaignGroups({ fetchImpl: g }), (e) => /expired/.test(e.message) && !e.message.includes(TOKEN));
  const h = mockFetch([[/./, { __status: 403, message: 'Not enough permissions' }]]);
  await assert.rejects(listCampaignGroups({ fetchImpl: h }), /r_ads and r_ads_reporting/);
  assert.equal(redact(`Bearer ${TOKEN}`), 'Bearer [redacted]');
});

test('missing token and bad account ids fail before any request', async () => {
  const saved = process.env.LINKEDIN_ACCESS_TOKEN;
  delete process.env.LINKEDIN_ACCESS_TOKEN;
  await assert.rejects(listAccounts({ fetchImpl: mockFetch([]) }), /LINKEDIN_ACCESS_TOKEN is not set/);
  process.env.LINKEDIN_ACCESS_TOKEN = saved;
  assert.equal(accountId('urn:li:sponsoredAccount:987654321'), '987654321');
  assert.equal(accountId(), '123456789');
  assert.throws(() => accountId('act_42x'), /not a LinkedIn ad account id/);
});

test('dateWindow: inclusive 30-day default ending today, validated', () => {
  assert.deepEqual(dateWindow({ now: new Date(Date.UTC(2026, 9, 4)) }), { since: '2026-09-05', until: '2026-10-04' });
  assert.deepEqual(dateWindow({ until: '2026-03-07', days: 7 }), { since: '2026-03-01', until: '2026-03-07' });
  assert.throws(() => dateWindow({ since: '2026/01/01' }), /YYYY-MM-DD/);
  assert.throws(() => dateWindow({ since: '2026-02-01', until: '2026-01-01' }), /after/);
});

test('describeBid: auto target, manual unit cost, and no bid at all', () => {
  assert.equal(describeBid({ optimizationTargetType: 'MAX_LEAD' }).text, 'auto MAX_LEAD');
  assert.equal(describeBid({ optimizationTargetType: 'NONE', costType: 'CPC', unitCost: { amount: '6.5', currencyCode: 'USD' } }).text, 'manual CPC 6.50 USD');
  assert.deepEqual(describeBid({ optimizationTargetType: 'NONE', unitCost: { amount: '0' } }).strategy, 'none');
});

test('metrics: ratios are null, not 0 or Infinity, when the denominator is 0', () => {
  const m = metrics({ costInLocalCurrency: '50', impressions: 10000, clicks: 0, oneClickLeads: 0 });
  assert.equal(m.cpm, 5);
  assert.equal(m.ctr, 0);
  assert.equal(m.cpc, null);
  assert.equal(m.cpl, null);
  const n = metrics({ costInLocalCurrency: '120', impressions: 4000, clicks: 40, landingPageClicks: 30, oneClickLeads: 4 });
  assert.deepEqual([n.ctr, n.cpc, n.cpl, n.costPerLandingPageClick], [1, 3, 30, 4]);
});

test('listCampaigns follows nextPageToken, builds the search filter, and names the group', async () => {
  const p1 = { elements: [CAMPAIGNS.elements[0]], metadata: { nextPageToken: 'tok-2' } };
  const p2 = { elements: [CAMPAIGNS.elements[1]], metadata: {} };
  const f = mockFetch([
    [/adCampaigns\?q=search.*pageToken=tok-2/, p2],
    [/adCampaigns\?q=search/, p1],
    [/adCampaignGroups\?q=search/, GROUPS],
  ]);
  const rows = await listCampaigns({ status: 'ACTIVE,PAUSED', group: '600000001', fetchImpl: f });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].groupName, 'Q3 Pipeline');
  assert.equal(rows[1].bid.strategy, 'manual');
  const first = decodeURIComponent(f.calls.find((c) => c.url.includes('adCampaigns')).url);
  assert.match(first, /search=\(status:\(values:List\(ACTIVE,PAUSED\)\),campaignGroup:\(values:List\(urn:li:sponsoredCampaignGroup:600000001\)\)\)/);
});

test('performance: names, sort by spend, totals, filters in the query', async () => {
  const f = mockFetch([[/adAnalytics/, ANALYTICS], ...base]);
  const p = await performance({ since: '2026-07-01', until: '2026-07-31', campaigns: ['500000001', '500000002'], fetchImpl: f });
  assert.equal(p.currency, 'USD');
  assert.deepEqual(p.rows.map((r) => r.name), ['Ops leaders - lead form', 'Site visits - finance']);
  assert.equal(p.rows[0].cpl, 60.03);
  assert.equal(p.totals.spend, 1500.5);
  assert.equal(p.totals.impressions, 70000);
  const url = decodeURIComponent(f.calls.find((c) => c.url.includes('adAnalytics')).url);
  assert.match(url, /pivot=CAMPAIGN&timeGranularity=ALL&dateRange=\(start:\(year:2026,month:7,day:1\),end:\(year:2026,month:7,day:31\)\)/);
  assert.match(url, /campaigns=List\(urn:li:sponsoredCampaign:500000001,urn:li:sponsoredCampaign:500000002\)/);
  const view = performanceView(p);
  assert.match(view, /^Performance by campaign, 2026-07-01 to 2026-07-31 \(spend in USD\)/);
  assert.match(view, /total\s+1,500\.50/);
  assert.doesNotMatch(view, /undefined|NaN/);
  await assert.rejects(performance({ level: 'ad', fetchImpl: f }), /level must be/);
});

test('performance by month labels periods', async () => {
  const f = mockFetch([[/adAnalytics/, { elements: [row('urn:li:sponsoredAccount:123456789', { costInLocalCurrency: '10', impressions: 100 })] }], ...base]);
  const p = await performance({ level: 'account', granularity: 'monthly', since: '2026-07-01', until: '2026-08-31', fetchImpl: f });
  assert.equal(p.rows[0].period, '2026-07');
  assert.equal(p.rows[0].name, 'Example Co Ads');
});

const DEMO = {
  elements: [
    { pivotValues: ['urn:li:title:111'], impressions: 900, clicks: 9, costInLocalCurrency: '0' },
    { pivotValues: ['urn:li:title:222'], impressions: 4000, clicks: 30, costInLocalCurrency: '0' },
    { pivotValues: ['urn:li:title:333'], impressions: 3, clicks: 0, costInLocalCurrency: '0' },
  ],
};
const ENTITIES = { elements: [
  { urn: 'urn:li:title:111', name: 'Operations Manager', facetUrn: 'urn:li:adTargetingFacet:titles' },
  { urn: 'urn:li:title:111', name: 'Operations Manager', facetUrn: 'urn:li:adTargetingFacet:titlesPast' },
  { urn: 'urn:li:title:222', name: 'Controller', facetUrn: 'urn:li:adTargetingFacet:titles' },
] };

test('demographics: sorted, named, share of total, small values called withheld, unreported columns blank', async () => {
  const f = mockFetch([
    [/pivot=MEMBER_JOB_TITLE/, DEMO],
    [/pivot=ACCOUNT/, { elements: [{ pivotValues: ['urn:li:sponsoredAccount:123456789'], impressions: 5000, clicks: 45, costInLocalCurrency: '250' }] }],
    [/adTargetingEntities\?q=urns/, ENTITIES],
    ...base,
  ]);
  const d = await demographics({ pivot: 'job title', since: '2026-07-01', until: '2026-07-31', limit: 2, fetchImpl: f });
  assert.equal(d.pivot, 'MEMBER_JOB_TITLE');
  assert.deepEqual(d.rows.map((r) => [r.value, r.impressions, r.share]), [['Controller', 4000, 80], ['Operations Manager', 900, 18]]);
  assert.equal(d.returned, 3);
  assert.equal(d.rows[0].spend, null, 'spend was not reported for this pivot, so it is blank, not 0');
  assert.equal(d.rows[0].clicks, 30);
  assert.match(d.notes.join(' '), /withheld.*not zero/);
  assert.match(d.notes.join(' '), /do not sum/);
  assert.match(d.notes.join(' '), /no spend for this breakdown/);
  const view = demographicsView(d);
  assert.match(view, /Delivery by job title, 2026-07-01 to 2026-07-31: 5,000 impressions in total/);
  assert.match(view, /Top 2 of 3 values/);
  assert.doesNotMatch(view, /undefined|NaN/);
});

test('demographics: all values withheld is said out loud', async () => {
  const f = mockFetch([
    [/pivot=MEMBER_SENIORITY/, { elements: [] }],
    [/pivot=ACCOUNT/, { elements: [{ pivotValues: ['x'], impressions: 40 }] }],
    ...base,
  ]);
  const d = await demographics({ pivot: 'seniority', fetchImpl: f });
  assert.match(d.notes[0], /no MEMBER_SENIORITY rows for 40 impressions/);
});

test('company size values and pivot names', () => {
  assert.equal(companySizeLabel('SIZE_51_TO_200'), '51-200 employees');
  assert.equal(companySizeLabel('SIZE_10001_OR_MORE'), '10,001+ employees');
  assert.equal(companySizeLabel('SIZE_1'), '1 employee');
  assert.equal(pivotName('company_size'), 'MEMBER_COMPANY_SIZE');
  assert.equal(pivotName('MEMBER_COUNTRY_V2'), 'MEMBER_COUNTRY_V2');
  assert.throws(() => pivotName('age'), /Unknown breakdown/);
});

test('resolveUrns: batches of 50, one row per URN, company size resolved locally, unknowns kept as null', async () => {
  const urns = Array.from({ length: 60 }, (_, i) => `urn:li:title:${1000 + i}`);
  const f = mockFetch([[/adTargetingEntities\?q=urns/, (u) => ({ elements: [...u.matchAll(/urn:li:title:(\d+)/g)].filter((m) => m[1] !== '1059').map((m) => ({ urn: `urn:li:title:${m[1]}`, name: `Title ${m[1]}`, facetUrn: 'urn:li:adTargetingFacet:titles' })) })]]);
  const rows = await resolveUrns([...urns, urns[0], 'urn:li:staffCountRange:(51,200)'], { fetchImpl: f });
  assert.equal(f.calls.length, 2);
  assert.equal(rows.length, 61);
  assert.equal(rows[0].name, 'Title 1000');
  assert.equal(rows.find((r) => r.urn === 'urn:li:title:1059').name, null);
  assert.equal(rows.at(-1).name, '51-200 employees');
});

test('searchTargeting: typeahead when the facet has it, otherwise list, name and filter', async () => {
  const f = mockFetch([[/q=typeahead/, { elements: [{ urn: 'urn:li:geo:100000001', name: 'Springfield Area' }] }]]);
  assert.deepEqual(await searchTargeting('locations', 'spring', { fetchImpl: f }), [{ urn: 'urn:li:geo:100000001', name: 'Springfield Area' }]);
  const g = mockFetch([
    [/q=typeahead/, { __status: 400, message: 'Specified facet is not available for the finder' }],
    [/q=adTargetingFacet/, { elements: [{ urn: 'urn:li:seniority:5' }, { urn: 'urn:li:seniority:6' }] }],
    [/q=urns/, { elements: [{ urn: 'urn:li:seniority:5', name: 'Manager' }, { urn: 'urn:li:seniority:6', name: 'Director' }] }],
  ]);
  assert.deepEqual(await searchTargeting('seniorities', 'dir', { fetchImpl: g }), [{ urn: 'urn:li:seniority:6', name: 'Director' }]);
});

test('campaignTargeting: AND of ORs with every value named', async () => {
  const c = { id: 500000001, name: 'Ops leaders - lead form', status: 'ACTIVE', targetingCriteria: {
    include: { and: [{ or: { 'urn:li:adTargetingFacet:locations': ['urn:li:geo:100000001'] } }, { or: { 'urn:li:adTargetingFacet:titles': ['urn:li:title:111', 'urn:li:title:222'], 'urn:li:adTargetingFacet:seniorities': ['urn:li:seniority:6'] } }] },
    exclude: { or: { 'urn:li:adTargetingFacet:staffCountRanges': ['urn:li:staffCountRange:(1,1)'] } },
  } };
  const f = mockFetch([
    [/adCampaigns\/500000001$/, c],
    [/q=urns/, { elements: [...ENTITIES.elements, { urn: 'urn:li:geo:100000001', name: 'Springfield Area' }, { urn: 'urn:li:seniority:6', name: 'Director' }] }],
  ]);
  const t = await campaignTargeting({ campaign: '500000001', fetchImpl: f });
  assert.equal(t.include.length, 2);
  assert.equal(t.include[1][0].values[1].name, 'Controller');
  assert.equal(t.exclude[0].values[0].name, '1 employee');
  const view = targetingView(t);
  assert.match(view, /AND titles: Operations Manager OR Controller  OR  seniorities: Director/);
  assert.match(view, /EXCLUDE\nstaffCountRanges: 1 employee/);
});

const CREATIVES = { elements: [
  { id: 'urn:li:sponsoredCreative:700000001', campaign: 'urn:li:sponsoredCampaign:500000001', intendedStatus: 'ACTIVE', review: { status: 'APPROVED' }, isServing: true, content: { reference: 'urn:li:ugcPost:800000001' }, leadgenCallToAction: { destination: 'urn:li:adForm:900000001', label: 'DOWNLOAD' } },
  { id: 'urn:li:sponsoredCreative:700000002', name: 'Finance video', campaign: 'urn:li:sponsoredCampaign:500000002', intendedStatus: 'PAUSED', content: { reference: 'urn:li:ugcPost:800000002' } },
  { id: 'urn:li:sponsoredCreative:700000003', campaign: 'urn:li:sponsoredCampaign:500000002', intendedStatus: 'ACTIVE', content: { reference: 'urn:li:adInMailContent:1' } },
  { id: 'urn:li:sponsoredCreative:700000004', campaign: 'urn:li:sponsoredCampaign:500000002', intendedStatus: 'ACTIVE', content: { textAd: { headline: 'Close books faster', description: 'A checklist for month end', landingPage: 'https://example.com/checklist' } } },
] };
const POSTS = [
  [/posts\/urn:li:ugcPost:800000001/, { commentary: 'Your ops team is drowning in spreadsheets.', content: { media: { id: 'urn:li:video:1', title: 'Ops in 60 seconds' } } }],
  [/posts\/urn:li:ugcPost:800000002/, { commentary: 'See the month-end checklist.', content: { article: { source: 'https://example.com/guide', title: 'Month-end guide' } } }],
];

test('creatives: post text, landing page, CTA and lead form are read from the creative and its post', async () => {
  const f = mockFetch([[/creatives\?q=criteria/, CREATIVES], ...POSTS]);
  const c = await listCreatives({ campaign: ['500000001', '500000002'], fetchImpl: f });
  const [a, b, inmail, text] = c.rows;
  assert.deepEqual([a.format, a.text, a.cta, a.leadForm, a.landingPage], ['video', 'Your ops team is drowning in spreadsheets.', 'DOWNLOAD', '900000001', null]);
  assert.deepEqual([b.format, b.landingPage, b.title], ['article', 'https://example.com/guide', 'Month-end guide']);
  assert.match(inmail.note, /not fetched/);
  assert.deepEqual([text.format, text.title, text.landingPage], ['text ad', 'Close books faster', 'https://example.com/checklist']);
  assert.match(decodeURIComponent(f.calls[0].url), /campaigns=List\(urn:li:sponsoredCampaign:500000001,urn:li:sponsoredCampaign:500000002\)/);
  assert.doesNotMatch(creativesView(c), /undefined|NaN/);
});

const FORMS = { paging: { start: 0, count: 100, total: 1 }, elements: [{ id: 900000001, name: 'Ops checklist download', state: 'PUBLISHED', reviewInfo: { reviewStatus: 'APPROVED' }, content: { questions: [{ predefinedField: 'FIRST_NAME' }, { predefinedField: 'EMAIL' }, { name: 'team size' }] } }] };
const CREATIVE_ANALYTICS = { elements: [
  { pivotValues: ['urn:li:sponsoredCreative:700000001'], oneClickLeads: 12, oneClickLeadFormOpens: 40, costInLocalCurrency: '600' },
  { pivotValues: ['urn:li:sponsoredCreative:700000002'], oneClickLeads: 0, costInLocalCurrency: '90' },
] };

test('lead forms: counts per form from analytics; the lead responses endpoint is never called', async () => {
  const f = mockFetch([[/leadForms\?q=owner/, FORMS], [/creatives\?q=criteria/, CREATIVES], [/adAnalytics.*pivot=CREATIVE/, CREATIVE_ANALYTICS]]);
  const r = await leadForms({ since: '2026-07-01', until: '2026-07-31', fetchImpl: f });
  assert.deepEqual(r.rows, [{ id: '900000001', name: 'Ops checklist download', state: 'PUBLISHED', review: 'APPROVED', fields: ['FIRST_NAME', 'EMAIL', 'CUSTOM'], leads: 12, formOpens: 40, completionRate: 30, spend: 600, cpl: 50, creatives: 1 }]);
  assert.match(formsView(r), /Counts only/);
  for (const c of f.calls) assert.doesNotMatch(c.url, /leadFormResponses|leadResponses/i);
});

test('lead forms: without permission to list forms, counts still come through', async () => {
  const f = mockFetch([[/leadForms\?q=owner/, { __status: 403, message: 'denied' }], [/creatives\?q=criteria/, CREATIVES], [/adAnalytics/, CREATIVE_ANALYTICS]]);
  const r = await leadForms({ fetchImpl: f });
  assert.equal(r.rows[0].id, '900000001');
  assert.equal(r.rows[0].leads, 12);
  assert.equal(r.rows[0].name, null);
  assert.match(r.warning, /cannot list lead forms/);
});

test('no function in the package writes: every call across every tool is a GET', async () => {
  const f = mockFetch([
    [/adAnalytics.*pivot=MEMBER/, DEMO], [/adAnalytics.*pivot=CREATIVE/, CREATIVE_ANALYTICS], [/adAnalytics/, ANALYTICS],
    [/leadForms/, FORMS], [/creatives\?q=criteria/, CREATIVES], ...POSTS, [/adTargetingEntities/, ENTITIES],
    [/adAccounts\?q=search/, { elements: [ACCOUNT] }], [/adCampaigns\/500000001$/, { id: 500000001, targetingCriteria: {} }], ...base,
  ]);
  const o = { fetchImpl: f };
  await Promise.all([listAccounts(o), listCampaignGroups(o), listCampaigns(o), performance(o), demographics(o), listCreatives(o), leadForms(o), resolveUrns(['urn:li:title:111'], o), searchTargeting('titles', 'ops', o), campaignTargeting({ campaign: '500000001', ...o })]);
  assert.ok(f.calls.length > 10);
  for (const c of f.calls) {
    assert.equal(c.init.method, 'GET');
    assert.equal(c.init.body, undefined);
  }
});

test('views and csv', () => {
  const rows = [{ ...CAMPAIGNS.elements[1], id: '500000002', name: 'Site visits, "finance"', bid: { strategy: 'none', text: 'no bid set' }, groupName: 'Q3', servingStatuses: [] }];
  assert.match(campaignsView(rows), /"no bid set": no optimization target/);
  const out = csv([{ name: 'a, "b"', list: ['x', 'y'], bid: { text: 'auto MAX_LEAD' } }]);
  assert.equal(out, 'name,list,bid\n"a, ""b""",x;y,auto MAX_LEAD');
});

test('status filters are allowlisted, so nothing can be appended to the Rest.li query', async () => {
  const f = mockFetch(base);
  await assert.rejects(listCampaigns({ status: 'ACTIVE)))&foo=bar', fetchImpl: f }), /Unknown status/);
  await assert.rejects(listCampaignGroups({ status: ['PAUSED', 'LIVE'], fetchImpl: f }), /Unknown status "LIVE"/);
  assert.equal(f.calls.length, 0, 'rejected before any request');
  await listCampaignGroups({ status: 'active,pending_deletion', fetchImpl: f });
  assert.match(decodeURIComponent(f.calls[0].url), /status:\(values:List\(ACTIVE,PENDING_DELETION\)\)/);
  assert.deepEqual(STATUSES, ['ACTIVE', 'PAUSED', 'ARCHIVED', 'DRAFT', 'CANCELED', 'COMPLETED', 'PENDING_DELETION', 'REMOVED']);
});

test('campaign, group and creative ids must be digits or a well-formed URN', async () => {
  assert.equal(numericId('500000001'), '500000001');
  assert.equal(numericId('urn:li:sponsoredCampaign:500000001'), '500000001');
  for (const bad of ['500000001/../../adAccounts', '500000001&x=1', 'urn:li:sponsoredCampaign:abc', 'abc:500000001x', '', 'urn:li::5']) assert.throws(() => numericId(bad, 'campaign id'), /not a valid campaign id/);
  const f = mockFetch([[/./, { elements: [] }]]);
  await assert.rejects(campaignTargeting({ campaign: '500000001/../x', fetchImpl: f }), /not a valid campaign id/);
  await assert.rejects(listCampaigns({ group: '600000001)&x=1', fetchImpl: f }), /not a valid campaign group id/);
  await assert.rejects(performance({ campaigns: ['500000001,urn:li:x:1&y'], fetchImpl: f }), /not a valid campaign id/);
  await assert.rejects(demographics({ groups: 'abc', fetchImpl: f }), /not a valid campaign group id/);
  await assert.rejects(listCreatives({ campaign: '1;2', fetchImpl: f }), /not a valid campaign id/);
  assert.equal(f.calls.length, 0, 'rejected before any request');
});

test('the CLI rejects bad ids and statuses too', async () => {
  const { execFileSync } = await import('node:child_process');
  const cli = new URL('../bin/linkedin-ads.mjs', import.meta.url).pathname;
  for (const args of [['targeting', '500000001/../x'], ['campaigns', '--status', 'ACTIVE&x=1'], ['creatives', '--campaign', 'abc']]) {
    assert.throws(() => execFileSync(process.execPath, [cli, ...args], { env: { ...process.env, LINKEDIN_ACCESS_TOKEN: TOKEN }, stdio: 'pipe' }), (e) => e.status === 1 && /not a valid|Unknown status/.test(String(e.stderr)));
  }
});

test('.mcp.json pins the major version instead of @latest', async () => {
  const { readFileSync } = await import('node:fs');
  const cfg = JSON.parse(readFileSync(new URL('../.mcp.json', import.meta.url), 'utf8'));
  assert.deepEqual(cfg.mcpServers['linkedin-ads'].args, ['-y', 'linkedin-ads-readonly-mcp@0', 'mcp']);
});
