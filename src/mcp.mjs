import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'node:module';
import { campaignTargeting, demographics, leadForms, listAccounts, listCampaignGroups, listCampaigns, listCreatives, performance, PIVOTS, resolveUrns, searchTargeting, STATUSES } from './ads.mjs';
import { accountsView, campaignsView, creativesView, demographicsView, entitiesView, formsView, groupsView, performanceView, targetingView } from './format.mjs';
import { redact } from './http.mjs';

const { version } = createRequire(import.meta.url)('../package.json');
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const run = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (e) {
    return { content: [{ type: 'text', text: redact(e.message || String(e)) }], isError: true };
  }
};
const result = (text, data) => ({ content: [{ type: 'text', text }], structuredContent: data });

const account = z.string().regex(/^(\d+|urn:li:sponsoredAccount:\d+)$/, 'account id: digits').optional().describe('Ad account id (digits). Defaults to LINKEDIN_AD_ACCOUNT_ID.');
const ID = /^(\d+|urn:li:[A-Za-z]+:\d+)$/;
const id = (what) => z.string().regex(ID, `${what} id: digits or urn:li:<type>:<digits>`);
const ids = (what) => z.array(id(what)).optional().describe(`Limit to these ${what} ids`);
const status = (eg) => z.array(z.enum(STATUSES)).optional().describe(`${eg} Default: all.`);
const range = {
  since: z.string().optional().describe('Start date YYYY-MM-DD, inclusive. Default: 30 days before until.'),
  until: z.string().optional().describe('End date YYYY-MM-DD, inclusive. Default: today (UTC).'),
};

export async function startServer() {
  const server = new McpServer({ name: 'linkedin-ads', version });

  server.registerTool(
    'list_ad_accounts',
    {
      title: 'List LinkedIn ad accounts',
      description: 'Every LinkedIn ad account the access token can read: id, name, currency, status and serving status. Use first to find the account id for other tools.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    run(async () => {
      const rows = await listAccounts();
      return result(accountsView(rows), { rows });
    }),
  );

  server.registerTool(
    'list_campaign_groups',
    {
      title: 'List campaign groups',
      description: 'Campaign groups in an ad account with status, objective, total budget and schedule.',
      inputSchema: { account, status: status('e.g. ["ACTIVE","PAUSED"].') },
      annotations: READ_ONLY,
    },
    run(async (a) => {
      const rows = await listCampaignGroups(a);
      return result(groupsView(rows), { rows });
    }),
  );

  server.registerTool(
    'list_campaigns',
    {
      title: 'List campaigns',
      description:
        'Campaigns in an ad account with status, objective, format, bid (auto target or manual unit cost), daily and total budget and schedule. "no bid set" means no optimization target and no unit cost.',
      inputSchema: { account, status: status('e.g. ["ACTIVE"].'), group: ids('campaign group') },
      annotations: READ_ONLY,
    },
    run(async (a) => {
      const rows = await listCampaigns(a);
      return result(campaignsView(rows), { rows });
    }),
  );

  server.registerTool(
    'get_performance',
    {
      title: 'Campaign performance',
      description:
        'Spend, impressions, clicks, landing-page clicks, lead form leads, website conversions, CTR, CPC, CPM and cost per lead over a date range, by campaign, creative, campaign group or account, in total or daily/monthly/yearly. "clicks" counts every click on the ad; "landingPageClicks" are clicks to the site. Spend is in the account currency.',
      inputSchema: {
        account,
        level: z.enum(['campaign', 'creative', 'group', 'account']).optional().describe('Default campaign'),
        granularity: z.enum(['all', 'daily', 'monthly', 'yearly']).optional().describe('Default all (one row per entity)'),
        ...range,
        campaigns: ids('campaign'),
        groups: ids('campaign group'),
      },
      annotations: READ_ONLY,
    },
    run(async (a) => {
      const p = await performance(a);
      return result(performanceView(p), p);
    }),
  );

  server.registerTool(
    'get_demographics',
    {
      title: 'Audience demographics',
      description:
        'Who the ads reached: impressions, share of impressions, clicks, CTR, spend and leads by job title, job function, seniority, industry, company size, company, country or region. LinkedIn withholds values with very small counts for member privacy, so a missing value is withheld, not zero. Values overlap (a member can hold several titles), so rows can sum to more than the total; never add them up.',
      inputSchema: {
        account,
        breakdown: z.enum(Object.keys(PIVOTS)).describe('Member attribute to break down by'),
        ...range,
        campaigns: ids('campaign'),
        groups: ids('campaign group'),
        limit: z.number().int().min(1).max(500).optional().describe('Top N values by impressions. Default 25.'),
      },
      annotations: READ_ONLY,
    },
    run(async ({ breakdown, ...a }) => {
      const d = await demographics({ pivot: breakdown, ...a });
      return result(demographicsView(d), d);
    }),
  );

  server.registerTool(
    'list_creatives',
    {
      title: 'List creatives',
      description: 'Creatives in an account or campaign with review and serving status, format, post text, headline, landing page, call to action and lead form.',
      inputSchema: { account, campaigns: ids('campaign'), limit: z.number().int().min(1).max(500).optional().describe('Default 50') },
      annotations: READ_ONLY,
    },
    run(async ({ campaigns, ...a }) => {
      const c = await listCreatives({ campaign: campaigns, ...a });
      return result(creativesView(c), c);
    }),
  );

  server.registerTool(
    'list_lead_forms',
    {
      title: 'Lead gen forms and lead counts',
      description:
        'Lead gen forms on the account with state, review status, the field types they ask for, and form opens, leads, completion rate and cost per lead over a date range. Counts only: lead names, emails and answers are never fetched.',
      inputSchema: { account, ...range },
      annotations: READ_ONLY,
    },
    run(async (a) => {
      const f = await leadForms(a);
      return result(formsView(f), f);
    }),
  );

  server.registerTool(
    'get_campaign_targeting',
    {
      title: 'Campaign targeting, named',
      description: "A campaign's targeting criteria with every URN resolved to a name (locations, titles, industries, seniorities, companies ...). Include clauses are ANDed; values inside a clause are ORed.",
      inputSchema: { account, campaign: id('campaign').describe('Campaign id') },
      annotations: READ_ONLY,
    },
    run(async (a) => {
      const t = await campaignTargeting(a);
      return result(targetingView(t), t);
    }),
  );

  server.registerTool(
    'resolve_targeting_urns',
    {
      title: 'Name targeting URNs',
      description: 'Resolve LinkedIn URNs such as urn:li:geo:..., urn:li:title:..., urn:li:industry:..., urn:li:seniority:..., urn:li:organization:... to their names.',
      inputSchema: { urns: z.array(z.string()).min(1).max(500) },
      annotations: READ_ONLY,
    },
    run(async ({ urns }) => {
      const rows = await resolveUrns(urns);
      return result(entitiesView(rows), { rows });
    }),
  );

  server.registerTool(
    'search_targeting',
    {
      title: 'Find targeting URNs',
      description: 'Search a targeting facet by text and get URNs with names, e.g. facet "titles" query "marketing manager", or "locations" "Ohio". Facets: locations, titles, industries, seniorities, jobFunctions, skills, employers, staffCountRanges and others.',
      inputSchema: { facet: z.string(), query: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: READ_ONLY,
    },
    run(async ({ facet, query, limit }) => {
      const rows = await searchTargeting(facet, query, { limit });
      return result(entitiesView(rows, `${facet}${query ? `: "${query}"` : ''}`), { rows });
    }),
  );

  await server.connect(new StdioServerTransport());
}
