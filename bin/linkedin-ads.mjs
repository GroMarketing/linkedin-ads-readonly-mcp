#!/usr/bin/env node
import { campaignTargeting, demographics, leadForms, listAccounts, listCampaignGroups, listCampaigns, listCreatives, performance, PIVOTS, resolveUrns, searchTargeting } from '../src/ads.mjs';
import { accountsView, campaignsView, creativesView, csv, demographicsView, entitiesView, formsView, groupsView, performanceView, targetingView } from '../src/format.mjs';
import { redact } from '../src/http.mjs';

const HELP = `linkedin-ads: read your LinkedIn Ads data from the terminal or an AI agent. Read-only.

  linkedin-ads accounts
      Ad accounts your token can read.

  linkedin-ads groups    [--status ACTIVE,PAUSED]
  linkedin-ads campaigns [--status ACTIVE] [--group <id>]
      Campaign groups and campaigns: status, objective, bid, budget, schedule.

  linkedin-ads performance [--level campaign|creative|group|account] [--granularity all|daily|monthly|yearly]
                           [--campaign <id,id>] [--group <id,id>]
      Spend, impressions, clicks, landing-page clicks, leads, conversions, CTR, CPC, CPM, CPL.

  linkedin-ads demographics <${Object.keys(PIVOTS).join('|')}> [--limit 25] [--campaign <id,id>]
      Delivery by member attribute. Small counts are withheld by LinkedIn, not zero.

  linkedin-ads creatives [--campaign <id,id>] [--limit 50]
      Post text, headline, landing page, CTA and lead form for each creative.

  linkedin-ads forms
      Lead gen forms with opens, leads, completion rate and CPL. Counts only, never lead details.

  linkedin-ads targeting <campaign-id>
      A campaign's targeting with every URN named.

  linkedin-ads resolve <urn>...
  linkedin-ads lookup <facet> [text]
      Name URNs, or find them ("lookup titles 'product marketing'", "lookup locations Ohio").

  linkedin-ads mcp
      Run as an MCP server (stdio) for Claude Code, Cursor and others.

Common options:
  --account <id>              default LINKEDIN_AD_ACCOUNT_ID
  --since YYYY-MM-DD          default 30 days before --until (or use --days N)
  --until YYYY-MM-DD          default today (UTC)
  --json | --csv              machine output instead of the table

Credentials come from the environment (see README): LINKEDIN_ACCESS_TOKEN [, LINKEDIN_AD_ACCOUNT_ID, LINKEDIN_API_VERSION]`;

const argv = process.argv.slice(2);
const cmd = argv.shift();
const VALUED = new Set(['account', 'since', 'until', 'days', 'level', 'granularity', 'campaign', 'group', 'status', 'limit']);
const opt = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const [k, inline] = a.startsWith('--') ? a.slice(2).split(/=(.*)/s) : [];
  if (k && VALUED.has(k)) opt[k] = inline ?? argv[++i];
  else if (k) opt[k] = true;
  else pos.push(a);
}
const base = { account: opt.account };
const range = { since: opt.since, until: opt.until, days: opt.days ? Number(opt.days) : undefined };

/** --json prints the whole result; --csv prints its rows; otherwise the table. */
const emit = (data, view) => {
  if (opt.json) console.log(JSON.stringify(data, null, 2));
  else if (opt.csv) console.log(csv(Array.isArray(data) ? data : data.rows));
  else console.log(view(data));
};

async function main() {
  switch (cmd) {
    case 'mcp':
      return (await import('../src/mcp.mjs')).startServer();
    case 'accounts':
      return emit(await listAccounts(), accountsView);
    case 'groups':
      return emit(await listCampaignGroups({ ...base, status: opt.status }), groupsView);
    case 'campaigns':
      return emit(await listCampaigns({ ...base, status: opt.status, group: opt.group }), campaignsView);
    case 'performance':
    case 'perf':
      return emit(await performance({ ...base, ...range, level: opt.level, granularity: opt.granularity, campaigns: opt.campaign, groups: opt.group }), performanceView);
    case 'demographics':
    case 'demo':
      if (!pos[0]) return usage(`give a breakdown: ${Object.keys(PIVOTS).join(', ')}`);
      return emit(await demographics({ ...base, ...range, pivot: pos[0], campaigns: opt.campaign, groups: opt.group, limit: opt.all ? 0 : Number(opt.limit || 25) }), demographicsView);
    case 'creatives':
      return emit(await listCreatives({ ...base, campaign: opt.campaign, limit: opt.all ? 0 : Number(opt.limit || 50) }), creativesView);
    case 'forms':
      return emit(await leadForms({ ...base, ...range }), formsView);
    case 'targeting':
      if (!pos[0]) return usage('give a campaign id');
      return emit(await campaignTargeting({ ...base, campaign: pos[0] }), targetingView);
    case 'resolve':
      if (!pos.length) return usage('give one or more URNs');
      return emit(await resolveUrns(pos), (rows) => entitiesView(rows));
    case 'lookup':
      if (!pos[0]) return usage('give a facet (locations, titles, industries, seniorities, ...) and optional text');
      return emit(await searchTargeting(pos[0], pos.slice(1).join(' '), { limit: Number(opt.limit || 25) }), (rows) => entitiesView(rows, `${pos[0]}${pos[1] ? `: "${pos.slice(1).join(' ')}"` : ''}`));
    default:
      console.log(HELP);
      process.exit(cmd && !['-h', '--help', 'help'].includes(cmd) ? 2 : 0);
  }
}

function usage(msg) {
  console.error(msg);
  process.exit(2);
}

main().catch((e) => {
  console.error(redact(e.message || e));
  process.exit(1);
});
