import { accountId, allOffsetPages, allPages, idOf, linkedinClient, numericId } from './linkedin.mjs';

const enc = encodeURIComponent;
const amount = (m) => (m?.amount != null && m.amount !== '' ? Number(m.amount) : null);
const day = (ms) => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : null);
const round = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const div = (a, b) => (b ? a / b : null);
const list = (urns) => `List(${urns.map(enc).join(',')})`;
const asArray = (v) => (v == null ? [] : (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean));

// ---------- dates ----------

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function dateWindow({ since, until, days = 30, now = new Date() } = {}) {
  const end = until || now.toISOString().slice(0, 10);
  const start = since || new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  for (const [k, v] of [['since', start], ['until', end]]) if (!ISO.test(v) || Number.isNaN(Date.parse(v))) throw new Error(`${k} must be YYYY-MM-DD, got "${v}".`);
  if (start > end) throw new Error(`since (${start}) is after until (${end}).`);
  return { since: start, until: end };
}
const ymd = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `(year:${y},month:${m},day:${d})`;
};
const dateRange = ({ since, until }) => `(start:${ymd(since)},end:${ymd(until)})`;

// ---------- accounts, groups, campaigns ----------

export async function listAccounts(opts = {}) {
  const api = linkedinClient(opts);
  const els = await allPages(api, 'adAccounts?q=search');
  return els.map((a) => ({
    id: String(a.id),
    name: a.name,
    currency: a.currency,
    status: a.status,
    type: a.type,
    servingStatuses: a.servingStatuses || [],
    test: Boolean(a.test),
  }));
}

async function account(api, id) {
  try {
    return await api.get(`adAccounts/${id}`);
  } catch {
    return {}; // only used for the currency label; analytics can still answer
  }
}

export const STATUSES = ['ACTIVE', 'PAUSED', 'ARCHIVED', 'DRAFT', 'CANCELED', 'COMPLETED', 'PENDING_DELETION', 'REMOVED'];
const statusFilter = (status) => {
  const s = asArray(status).map((x) => x.toUpperCase());
  const bad = s.filter((x) => !STATUSES.includes(x));
  if (bad.length) throw new Error(`Unknown status "${bad.join(', ')}". Use: ${STATUSES.join(', ')}.`);
  return s.length ? s : null;
};

export async function listCampaignGroups({ account: acct, status, ...opts } = {}) {
  const api = linkedinClient(opts);
  const id = accountId(acct);
  const s = statusFilter(status);
  const els = await allPages(api, `adAccounts/${id}/adCampaignGroups?q=search${s ? `&search=(status:(values:List(${s.join(',')})))` : ''}`);
  return els.map((g) => ({
    id: String(g.id),
    name: g.name,
    status: g.status,
    objective: g.objectiveType || null,
    totalBudget: amount(g.totalBudget),
    currency: g.totalBudget?.currencyCode || null,
    start: day(g.runSchedule?.start),
    end: day(g.runSchedule?.end),
    servingStatuses: g.servingStatuses || [],
  }));
}

/** How the campaign bids, in words. A target of NONE with no unit cost is no bid at all. */
export function describeBid(c) {
  const target = c.optimizationTargetType && c.optimizationTargetType !== 'NONE' ? c.optimizationTargetType : null;
  const unit = amount(c.unitCost);
  const cur = c.unitCost?.currencyCode || '';
  const money = unit ? `${unit.toFixed(2)} ${cur}`.trim() : null;
  if (target) return { strategy: 'auto', target, unitCost: unit || null, text: `auto ${target}${money ? `, ${money}` : ''}` };
  if (unit > 0) return { strategy: 'manual', target: null, unitCost: unit, text: `manual ${c.costType || ''} ${money}`.replace(/\s+/g, ' ') };
  return { strategy: 'none', target: null, unitCost: null, text: 'no bid set' };
}

export async function listCampaigns({ account: acct, status, group, ...opts } = {}) {
  const api = linkedinClient(opts);
  const id = accountId(acct);
  const parts = [];
  const s = statusFilter(status);
  if (s) parts.push(`status:(values:List(${s.join(',')}))`);
  const groups = asArray(group).map((g) => `urn:li:sponsoredCampaignGroup:${numericId(g, 'campaign group id')}`);
  if (groups.length) parts.push(`campaignGroup:(values:${list(groups)})`);
  const [els, groupRows] = await Promise.all([
    allPages(api, `adAccounts/${id}/adCampaigns?q=search${parts.length ? `&search=(${parts.join(',')})` : ''}`),
    listCampaignGroups({ account: id, ...opts }).catch(() => []),
  ]);
  const groupName = Object.fromEntries(groupRows.map((g) => [g.id, g.name]));
  return els.map((c) => campaignRow(c, groupName));
}

function campaignRow(c, groupName = {}) {
  const gid = c.campaignGroup ? idOf(c.campaignGroup) : null;
  return {
    id: String(c.id),
    name: c.name,
    groupId: gid,
    groupName: gid ? groupName[gid] || null : null,
    status: c.status,
    servingStatuses: c.servingStatuses || [],
    objective: c.objectiveType || null,
    type: c.type || null,
    format: c.format || null,
    costType: c.costType || null,
    bid: describeBid(c),
    dailyBudget: amount(c.dailyBudget),
    totalBudget: amount(c.totalBudget),
    currency: c.dailyBudget?.currencyCode || c.totalBudget?.currencyCode || c.unitCost?.currencyCode || null,
    start: day(c.runSchedule?.start),
    end: day(c.runSchedule?.end),
  };
}

// ---------- analytics ----------

const FIELDS = 'costInLocalCurrency,impressions,clicks,landingPageClicks,oneClickLeads,oneClickLeadFormOpens,externalWebsiteConversions,pivotValues,dateRange';

/** Raw counts plus the ratios people ask for. Ratios are null when the denominator is 0. */
export function metrics(e = {}) {
  const spend = Number(e.costInLocalCurrency || 0);
  const impressions = Number(e.impressions || 0);
  const clicks = Number(e.clicks || 0);
  const landingPageClicks = Number(e.landingPageClicks || 0);
  const leads = Number(e.oneClickLeads || 0);
  const formOpens = Number(e.oneClickLeadFormOpens || 0);
  const conversions = Number(e.externalWebsiteConversions || 0);
  return {
    spend: round(spend),
    impressions,
    clicks,
    landingPageClicks,
    leads,
    formOpens,
    conversions,
    ctr: round(div(clicks, impressions) * 100, 2),
    cpc: round(div(spend, clicks)),
    cpm: round(div(spend, impressions) * 1000),
    costPerLandingPageClick: round(div(spend, landingPageClicks)),
    cpl: round(div(spend, leads)),
    costPerConversion: round(div(spend, conversions)),
  };
}

function sumRaw(els) {
  const t = {};
  for (const e of els) for (const k of FIELDS.split(',')) if (typeof e[k] === 'number' || (typeof e[k] === 'string' && k.startsWith('cost'))) t[k] = (t[k] || 0) + Number(e[k] || 0);
  return t;
}

const LEVELS = {
  campaign: { pivot: 'CAMPAIGN', urn: 'sponsoredCampaign' },
  creative: { pivot: 'CREATIVE', urn: 'sponsoredCreative' },
  group: { pivot: 'CAMPAIGN_GROUP', urn: 'sponsoredCampaignGroup' },
  account: { pivot: 'ACCOUNT', urn: 'sponsoredAccount' },
};
const GRANULARITY = ['ALL', 'DAILY', 'MONTHLY', 'YEARLY'];

function analyticsPath({ pivot, granularity = 'ALL', window, account: id, campaigns = [], groups = [], fields = FIELDS }) {
  let p = `adAnalytics?q=analytics&pivot=${pivot}&timeGranularity=${granularity}&dateRange=${dateRange(window)}&accounts=${list([`urn:li:sponsoredAccount:${id}`])}`;
  if (campaigns.length) p += `&campaigns=${list(campaigns.map((c) => `urn:li:sponsoredCampaign:${numericId(c, 'campaign id')}`))}`;
  if (groups.length) p += `&campaignGroups=${list(groups.map((g) => `urn:li:sponsoredCampaignGroup:${numericId(g, 'campaign group id')}`))}`;
  return `${p}&fields=${fields}`;
}

const period = (dr, granularity) => {
  if (!dr?.start || granularity === 'ALL') return null;
  const { year, month, day: d } = dr.start;
  const mm = String(month).padStart(2, '0');
  if (granularity === 'YEARLY') return String(year);
  if (granularity === 'MONTHLY') return `${year}-${mm}`;
  return `${year}-${mm}-${String(d).padStart(2, '0')}`;
};

/**
 * Delivery and results over a date range, by campaign, creative, campaign group or account.
 * Entities with no delivery in the range are not returned by LinkedIn and are not listed.
 */
export async function performance({ account: acct, level = 'campaign', since, until, days, granularity = 'ALL', campaigns, groups, ...opts } = {}) {
  const L = LEVELS[level];
  if (!L) throw new Error(`level must be one of ${Object.keys(LEVELS).join(', ')}.`);
  const g = String(granularity).toUpperCase();
  if (!GRANULARITY.includes(g)) throw new Error(`granularity must be one of ${GRANULARITY.join(', ').toLowerCase()}.`);
  const api = linkedinClient(opts);
  const id = accountId(acct);
  const window = dateWindow({ since, until, days });
  const [a, acc, names] = await Promise.all([
    api.get(analyticsPath({ pivot: L.pivot, granularity: g, window, account: id, campaigns: asArray(campaigns), groups: asArray(groups) })),
    account(api, id),
    nameLookup(api, level, id, opts),
  ]);
  const rows = (a.elements || []).map((e) => {
    const eid = idOf(e.pivotValues?.[0]);
    const n = names[eid] || {};
    return { id: eid, name: n.name || (level === 'account' ? acc.name : null) || null, ...(n.campaign ? { campaign: n.campaign } : {}), period: period(e.dateRange, g), ...metrics(e) };
  });
  rows.sort((x, y) => (x.period || '').localeCompare(y.period || '') || y.spend - x.spend || y.impressions - x.impressions);
  return { level, granularity: g, ...window, account: id, currency: acc.currency || null, rows, totals: metrics(sumRaw(a.elements || [])) };
}

/** id -> { name, campaign } for the pivot being reported, so rows read as names, not numbers. */
async function nameLookup(api, level, id, opts) {
  try {
    if (level === 'campaign') {
      const els = await allPages(api, `adAccounts/${id}/adCampaigns?q=search`);
      return Object.fromEntries(els.map((c) => [String(c.id), { name: c.name }]));
    }
    if (level === 'group') {
      const els = await allPages(api, `adAccounts/${id}/adCampaignGroups?q=search`);
      return Object.fromEntries(els.map((g) => [String(g.id), { name: g.name }]));
    }
    if (level === 'creative') {
      const [crs, camps] = await Promise.all([allPages(api, `adAccounts/${id}/creatives?q=criteria`), allPages(api, `adAccounts/${id}/adCampaigns?q=search`)]);
      const cname = Object.fromEntries(camps.map((c) => [String(c.id), c.name]));
      return Object.fromEntries(crs.map((cr) => [idOf(cr.id), { name: cr.name || null, campaign: cname[idOf(cr.campaign)] || idOf(cr.campaign) }]));
    }
  } catch {
    // names are a convenience; ids still identify every row
  }
  return {};
}

// ---------- demographics ----------

export const PIVOTS = {
  job_title: 'MEMBER_JOB_TITLE',
  job_function: 'MEMBER_JOB_FUNCTION',
  seniority: 'MEMBER_SENIORITY',
  industry: 'MEMBER_INDUSTRY',
  company_size: 'MEMBER_COMPANY_SIZE',
  company: 'MEMBER_COMPANY',
  country: 'MEMBER_COUNTRY_V2',
  region: 'MEMBER_REGION_V2',
};

export function pivotName(p) {
  const s = String(p || '').trim();
  const key = s.toLowerCase().replace(/[\s-]+/g, '_');
  if (PIVOTS[key]) return PIVOTS[key];
  if (Object.values(PIVOTS).includes(s.toUpperCase())) return s.toUpperCase();
  throw new Error(`Unknown breakdown "${p}". Use one of: ${Object.keys(PIVOTS).join(', ')}.`);
}

/** SIZE_51_TO_200 -> "51-200 employees". */
export function companySizeLabel(v) {
  const m = String(v).match(/SIZE_(\d+)(?:_TO_(\d+)|_OR_MORE)?$/);
  if (!m) return null;
  if (m[2]) return `${Number(m[1]).toLocaleString('en-US')}-${Number(m[2]).toLocaleString('en-US')} employees`;
  if (/_OR_MORE$/.test(v)) return `${Number(m[1]).toLocaleString('en-US')}+ employees`;
  return `${m[1]} employee${m[1] === '1' ? '' : 's'}`;
}

const DEMO_FIELDS = 'costInLocalCurrency,impressions,clicks,landingPageClicks,oneClickLeads,oneClickLeadFormOpens,externalWebsiteConversions,pivotValues';

/**
 * Who saw and clicked: delivery broken down by a member attribute.
 *
 * LinkedIn withholds values with very small counts to protect member privacy, so a
 * missing title or company means "withheld or none", never zero. Values also overlap
 * (a member can hold several titles or industries), so rows can add up to more than
 * the total and must not be summed.
 */
export async function demographics({ account: acct, pivot = 'job_title', since, until, days, campaigns, groups, limit = 25, ...opts } = {}) {
  const P = pivotName(pivot);
  const api = linkedinClient(opts);
  const id = accountId(acct);
  const window = dateWindow({ since, until, days });
  const filters = { window, account: id, campaigns: asArray(campaigns), groups: asArray(groups) };
  const [a, total, acc] = await Promise.all([
    api.get(analyticsPath({ pivot: P, ...filters, fields: DEMO_FIELDS })),
    api.get(analyticsPath({ pivot: 'ACCOUNT', ...filters, fields: DEMO_FIELDS })),
    account(api, id),
  ]);
  const els = [...(a.elements || [])].sort((x, y) => Number(y.impressions || 0) - Number(x.impressions || 0));
  const shown = limit ? els.slice(0, limit) : els;
  const urns = shown.map((e) => String(e.pivotValues?.[0] || '')).filter((v) => v.startsWith('urn:'));
  const names = urns.length ? Object.fromEntries((await resolveUrns(urns, opts)).map((r) => [r.urn, r.name])) : {};
  const t = metrics(sumRaw(total.elements || []));
  const rows = shown.map((e) => {
    const v = String(e.pivotValues?.[0] || '');
    const m = metrics(e);
    return { value: names[v] || companySizeLabel(v) || null, urn: v, ...m, share: t.impressions ? round((m.impressions / t.impressions) * 100, 1) : null };
  });
  const notes = [
    'LinkedIn leaves out values with very small counts to protect member privacy. A value that is missing here is withheld or had no delivery; it is not zero.',
    'Members can match several values (more than one title, industry or company), so rows can add up to more than the total. Read each row as a share of all impressions; do not sum them.',
  ];
  // Some breakdowns come back with impressions only. A column of zeros next to a non-zero
  // total is "not reported", so it is blanked rather than shown as 0.
  const blanked = [];
  for (const [m, label] of [['spend', 'spend'], ['clicks', 'clicks'], ['landingPageClicks', 'landing-page clicks'], ['leads', 'leads']]) {
    const all = els.reduce((s, e) => s + metrics(e)[m], 0);
    if (t[m] > 0 && all === 0) {
      blanked.push(label);
      for (const r of rows) {
        r[m] = null;
        if (m === 'spend') r.cpm = r.cpc = r.cpl = r.costPerLandingPageClick = r.costPerConversion = null;
        if (m === 'clicks') r.ctr = r.cpc = null;
        if (m === 'leads') r.cpl = null;
        if (m === 'landingPageClicks') r.costPerLandingPageClick = null;
      }
    }
  }
  if (blanked.length) notes.push(`LinkedIn reported no ${blanked.join(', ')} for this breakdown although the total has some. Those columns are blank because they were not reported, not because they are zero.`);
  if (!els.length && t.impressions) notes.unshift(
`LinkedIn returned no ${P} rows for ${t.impressions.toLocaleString('en-US')} impressions: every value was below its privacy minimum.`);
  return { pivot: P, ...window, account: id, currency: acc.currency || null, total: t, returned: els.length, rows, notes };
}

// ---------- targeting ----------

const FACET = (f) => (String(f).startsWith('urn:') ? String(f) : `urn:li:adTargetingFacet:${f}`);

/** URNs (geo, title, industry, seniority, function, organization, ...) to their names. */
export async function resolveUrns(urns, opts = {}) {
  const want = [...new Set(asArray(urns))];
  const local = {};
  const remote = [];
  for (const u of want) {
    const size = u.match(/^urn:li:staffCountRange:\((\d+),(\d+)\)$/);
    if (size) {
      const [lo, hi] = [Number(size[1]), Number(size[2])];
      const n = (x) => x.toLocaleString('en-US');
      local[u] = hi >= 2147483647 ? `${n(lo)}+ employees` : lo === hi ? `${n(lo)} employee${lo === 1 ? '' : 's'}` : `${n(lo)}-${n(hi)} employees`;
    }
    else if (companySizeLabel(u)) local[u] = companySizeLabel(u);
    else remote.push(u);
  }
  const found = {};
  if (remote.length) {
    const api = linkedinClient(opts);
    for (let i = 0; i < remote.length; i += 50) {
      const page = await api.get(`adTargetingEntities?q=urns&urns=${list(remote.slice(i, i + 50))}`);
      for (const e of page.elements || []) {
        const f = found[e.urn] || (found[e.urn] = { name: e.name, facets: [] });
        if (e.facetUrn) f.facets.push(idOf(e.facetUrn));
      }
    }
  }
  return want.map((urn) => (local[urn] ? { urn, name: local[urn], facets: ['staffCountRanges'] } : { urn, name: found[urn]?.name || null, facets: found[urn]?.facets || [] }));
}

/** Search a targeting facet by text ("titles", "marketing manager"). Facets without search are listed and filtered. */
export async function searchTargeting(facet, query = '', { limit = 25, ...opts } = {}) {
  const api = linkedinClient(opts);
  const f = FACET(facet);
  if (query) {
    try {
      const page = await api.get(`adTargetingEntities?q=typeahead&facet=${enc(f)}&query=${enc(query)}`);
      return (page.elements || []).slice(0, limit).map((e) => ({ urn: e.urn, name: e.name }));
    } catch (e) {
      if (e.status !== 400) throw e; // 400: this facet has no typeahead; list it instead
    }
  }
  const page = await api.get(`adTargetingEntities?q=adTargetingFacet&facet=${enc(f)}`);
  const urns = (page.elements || []).map((e) => e.urn || (e.value?.staffCountRange ? e.value.staffCountRange : null)).filter(Boolean);
  const named = await resolveUrns(urns, opts);
  const q = String(query).toLowerCase();
  return named.filter((r) => !q || (r.name || '').toLowerCase().includes(q)).slice(0, limit).map(({ urn, name }) => ({ urn, name }));
}

/** targetingCriteria -> [{ facet, urns }] for one OR block. */
function orBlock(or = {}) {
  return Object.entries(or).map(([facet, urns]) => ({ facet: idOf(facet), urns: (urns || []).map(String) }));
}

/** A campaign's targeting with every URN named: include is an AND of ORs, exclude is one OR. */
export async function campaignTargeting({ account: acct, campaign, ...opts } = {}) {
  if (!campaign) throw new Error('Give a campaign id.');
  const api = linkedinClient(opts);
  const id = accountId(acct);
  const c = await api.get(`adAccounts/${id}/adCampaigns/${numericId(campaign, 'campaign id')}`);
  const tc = c.targetingCriteria || {};
  const include = (tc.include?.and || []).map((clause) => orBlock(clause.or));
  const exclude = orBlock(tc.exclude?.or);
  const all = [...include.flat(), ...exclude].flatMap((b) => b.urns);
  const names = Object.fromEntries((await resolveUrns(all, opts)).map((r) => [r.urn, r.name]));
  const named = (b) => ({ facet: b.facet, values: b.urns.map((urn) => ({ urn, name: names[urn] || null })) });
  return {
    campaign: { id: String(c.id), name: c.name, status: c.status, audienceExpansion: Boolean(c.audienceExpansionEnabled), offsiteDelivery: Boolean(c.offsiteDeliveryEnabled) },
    include: include.map((clause) => clause.map(named)),
    exclude: exclude.map(named),
  };
}

// ---------- creatives ----------

function mediaKind(id = '') {
  if (/:video:/.test(id)) return 'video';
  if (/:image:/.test(id)) return 'image';
  if (/:document:/.test(id)) return 'document';
  return 'media';
}

/** What a creative says and where it sends people, read from the creative and its post. */
export async function listCreatives({ account: acct, campaign, limit = 50, ...opts } = {}) {
  const api = linkedinClient(opts);
  const id = accountId(acct);
  const camps = asArray(campaign).map((c) => `urn:li:sponsoredCampaign:${numericId(c, 'campaign id')}`);
  const els = await allPages(api, `adAccounts/${id}/creatives?q=criteria${camps.length ? `&campaigns=${list(camps)}` : ''}`);
  const shown = limit ? els.slice(0, limit) : els;
  const rows = [];
  for (let i = 0; i < shown.length; i += 5) rows.push(...(await Promise.all(shown.slice(i, i + 5).map((cr) => creativeRow(api, cr)))));
  return { account: id, total: els.length, rows };
}

async function creativeRow(api, cr) {
  const lead = cr.leadgenCallToAction;
  const row = {
    id: idOf(cr.id),
    name: cr.name || null,
    campaignId: idOf(cr.campaign),
    status: cr.intendedStatus || null,
    review: cr.review?.status || null,
    serving: Boolean(cr.isServing),
    holdReasons: cr.servingHoldReasons || [],
    format: null,
    title: null,
    text: null,
    landingPage: null,
    cta: lead?.label || null,
    leadForm: lead?.destination ? idOf(lead.destination) : null,
    note: null,
  };
  const c = cr.content || {};
  if (c.textAd) return { ...row, format: 'text ad', title: c.textAd.headline || null, text: c.textAd.description || null, landingPage: c.textAd.landingPage || null };
  if (c.spotlight) return { ...row, format: 'spotlight', title: c.spotlight.headline || null, text: c.spotlight.description || null, landingPage: c.spotlight.landingPage || null, cta: c.spotlight.callToAction || row.cta };
  const ref = c.reference;
  if (!ref) return { ...row, format: Object.keys(c)[0] || null, note: 'no post reference' };
  if (/inMailContent|conversation/i.test(ref)) return { ...row, format: 'message ad', note: 'message ad content is not fetched' };
  let post;
  try {
    post = await api.get(`posts/${enc(ref)}`);
  } catch (e) {
    return { ...row, note: `post unreadable (${e.status || 'error'})` };
  }
  const pc = post.content || {};
  const kind = pc.media ? mediaKind(pc.media.id) : pc.article ? 'article' : pc.multiImage ? 'multi-image' : pc.carousel ? 'carousel' : pc.poll ? 'poll' : pc.celebration ? 'celebration' : 'text';
  return {
    ...row,
    format: kind,
    title: pc.media?.title || pc.article?.title || null,
    text: post.commentary ?? null,
    landingPage: post.contentLandingPage || pc.article?.source || null,
    cta: post.contentCallToActionLabel || row.cta,
  };
}

// ---------- lead gen forms (counts only, never responses) ----------

/**
 * Lead gen forms on the account, with lead counts over the date range.
 *
 * Counts come from ad analytics (oneClickLeads per creative, rolled up to the form each
 * creative points at). This package never calls the lead responses endpoint, so it never
 * sees a name, email or any answer a member typed.
 */
export async function leadForms({ account: acct, since, until, days, ...opts } = {}) {
  const api = linkedinClient(opts);
  const id = accountId(acct);
  const window = dateWindow({ since, until, days });
  const owner = `(sponsoredAccount:${enc(`urn:li:sponsoredAccount:${id}`)})`;
  let forms = [];
  let warning = null;
  const [formsResult, creatives, a] = await Promise.all([
    allOffsetPages(api, `leadForms?q=owner&owner=${owner}`).catch((e) => e),
    allPages(api, `adAccounts/${id}/creatives?q=criteria`),
    api.get(analyticsPath({ pivot: 'CREATIVE', window, account: id, fields: 'oneClickLeads,oneClickLeadFormOpens,costInLocalCurrency,pivotValues' })),
  ]);
  if (formsResult instanceof Error) {
    if (formsResult.status !== 403 && formsResult.status !== 401) throw formsResult;
    warning = 'The token cannot list lead forms (403), so only forms referenced by creatives are shown, without names. Lead counts are unaffected.';
  } else forms = formsResult;

  const formOf = {};
  for (const cr of creatives) if (cr.leadgenCallToAction?.destination) formOf[idOf(cr.id)] = idOf(cr.leadgenCallToAction.destination);
  const counts = {};
  for (const e of a.elements || []) {
    const f = formOf[idOf(e.pivotValues?.[0])];
    if (!f) continue;
    const c = counts[f] || (counts[f] = { leads: 0, formOpens: 0, spend: 0, creatives: 0 });
    c.leads += Number(e.oneClickLeads || 0);
    c.formOpens += Number(e.oneClickLeadFormOpens || 0);
    c.spend += Number(e.costInLocalCurrency || 0);
    c.creatives += 1;
  }
  const row = (fid, f = {}) => {
    const c = counts[fid] || { leads: 0, formOpens: 0, spend: 0, creatives: 0 };
    const qs = f.content?.questions || [];
    return {
      id: fid,
      name: f.name || null,
      state: f.state || null,
      review: f.reviewInfo?.reviewStatus || null,
      fields: qs.map((q) => q.predefinedField || 'CUSTOM'),
      leads: c.leads,
      formOpens: c.formOpens,
      completionRate: c.formOpens ? round((c.leads / c.formOpens) * 100, 1) : null,
      spend: round(c.spend),
      cpl: round(div(c.spend, c.leads)),
      creatives: Object.values(formOf).filter((x) => x === fid).length,
    };
  };
  const listed = new Set(forms.map((f) => String(f.id)));
  const rows = [...forms.map((f) => row(String(f.id), f)), ...[...new Set(Object.values(formOf))].filter((f) => !listed.has(f)).map((f) => row(f))];
  rows.sort((x, y) => y.leads - x.leads || (x.name || '').localeCompare(y.name || ''));
  return { ...window, account: id, rows, warning };
}
