# linkedin-ads-readonly-mcp

A read-only LinkedIn Ads MCP server: your LinkedIn Campaign Manager data for AI
agents and the terminal. Ask what a campaign
spent, what a lead cost, which job titles the ads actually reached, or what a
campaign is targeting, and get the answer from LinkedIn's Marketing API with
your own token, on your own machine.

```
$ npx linkedin-ads-readonly-mcp performance --since 2026-08-01 --until 2026-08-31

Performance by campaign, 2026-08-01 to 2026-08-31 (spend in USD)

       id  name                            spend     impr  clicks  lp clicks    ctr   cpc    cpm  leads     cpl  conv
500000001  Ops leaders - lead form      2,410.75   96,400     538          0  0.56%  4.48  25.01     41   58.80     0
500000002  Finance directors - guide    1,385.20   41,250     310        221  0.75%  4.47  33.58      0             9
500000003  Retargeting - site visitors    402.10   18,830     167        119  0.89%  2.41  21.35      6   67.02     0
500000004  Video - brand awareness        612.00   88,100     205         48  0.23%  2.99   6.95      0             0
           total                        4,810.05  244,580   1,220        388  0.50%  3.94  19.67     47  102.34     9

clicks counts every click on the ad (profile, expand, play). lp clicks are clicks to your landing page. leads are lead gen form submissions; conv are website conversions.
Only campaigns with delivery in the range are listed.
```

*Illustrative output with made-up campaigns and numbers (run `node examples/sample-performance.mjs`); real runs return your account's figures.*

It runs as an MCP server (Claude Code, Cursor, Claude Desktop and others) and
as a CLI. It is **read-only**: the client only knows how to send GET requests,
so it cannot create, edit, pause or delete anything, and it never fetches lead
details.

## Why this one

LinkedIn does not publish an MCP server for its ads API. The hosted ones charge
a subscription and run your token through their servers. This one is open source,
runs locally, and is built for the questions analysts and marketers actually
ask:

- **Performance by campaign, creative, campaign group or account,** in total
  or by day, month or year, with CTR, CPC, CPM and cost per lead worked out
  for you. Ratios with a zero denominator are blank, not 0 or infinity.
- **Landing-page clicks next to clicks.** LinkedIn's `clicks` includes profile
  visits and video expands. A traffic campaign with 500 clicks and 0
  landing-page clicks sent nobody to your site, and the table shows it.
- **Demographics that say what they don't know.** LinkedIn withholds small
  counts for member privacy, and members match several titles or industries
  at once. The output says so, gives each value as a share of total
  impressions instead of a sum, and leaves a column blank when LinkedIn didn't
  report it rather than printing zeros.
- **Names instead of URNs.** Campaign and group names on every row, and
  targeting URNs (`urn:li:title:...`, `urn:li:geo:...`, companies, industries,
  seniorities, company sizes) resolved to what they mean.
- **Creatives with their copy.** Post text, headline, landing page, call to
  action and lead form, read from the creative and the post behind it.
- **Lead form counts without lead data.** Opens, submissions, completion rate
  and cost per lead per form, from ad analytics. The lead responses endpoint
  is never called, so no names or emails pass through your agent.
- **A clear message when LinkedIn retires an API version.** LinkedIn turns
  versions off about a year after release and answers with a bare 426; this
  tells you which setting to change.

If you need to check that a campaign can serve before you spend (bid,
destination, approval, geo, spend cap), that is a different job; see
[ad-preflight](https://github.com/GroMarketing/ad-preflight).

## Setup

You need three things from LinkedIn:

1. **A LinkedIn developer app** (linkedin.com/developers) with access to the
   **Advertising API** (part of the Marketing Developer Platform). Request it
   from the app's Products tab; LinkedIn reviews each request, and approval can
   take a while.
2. **An access token with the `r_ads` and `r_ads_reporting` scopes**, created
   through the app's OAuth flow or the developer portal's token generator.
   Tokens last 60 days.
3. **A role on the ad account** for the LinkedIn member who authorized the
   token. The token can read the accounts that member has a role on in
   Campaign Manager.

Then set these in your environment. See [`.env.example`](.env.example).

| Variable | |
|---|---|
| `LINKEDIN_ACCESS_TOKEN` | required |
| `LINKEDIN_AD_ACCOUNT_ID` | optional; the account used when a command doesn't name one (digits only) |
| `LINKEDIN_API_VERSION` | optional; `YYYYMM`, defaults to `202609` |

Credentials are read from the environment only. The token is sent in a request
header, never in a URL, and error messages are scrubbed of it before printing.

## MCP server

```bash
claude mcp add linkedin-ads -- npx -y linkedin-ads-readonly-mcp mcp     # Claude Code
```

For Cursor, Claude Desktop and others:

```json
{ "mcpServers": { "linkedin-ads": { "command": "npx", "args": ["-y", "linkedin-ads-readonly-mcp", "mcp"], "env": { "LINKEDIN_ACCESS_TOKEN": "..." } } } }
```

| Tool | What it does |
|---|---|
| `list_ad_accounts` | Accounts the token can read, with currency and status |
| `list_campaign_groups` | Groups with status, objective, total budget, schedule |
| `list_campaigns` | Campaigns with status, objective, bid, daily and total budget, schedule |
| `get_performance` | Spend, impressions, clicks, landing-page clicks, leads, conversions, CTR, CPC, CPM, CPL by campaign, creative, group or account |
| `get_demographics` | Delivery by job title, job function, seniority, industry, company size, company, country or region |
| `list_creatives` | Post text, headline, landing page, CTA, lead form and review status |
| `list_lead_forms` | Forms with state, field types, opens, leads, completion rate and CPL |
| `get_campaign_targeting` | A campaign's targeting with every URN named |
| `resolve_targeting_urns` | URNs to names |
| `search_targeting` | Find URNs by text in a facet (titles, locations, industries ...) |

All ten are annotated read-only. Account-scoped tools take an optional
`account`; date-ranged tools take `since` and `until` (`YYYY-MM-DD`,
inclusive, default the last 30 days).

## Claude Code plugin

```
/plugin marketplace add GroMarketing/linkedin-ads-readonly-mcp
/plugin install linkedin-ads@linkedin-ads-readonly-mcp
```

It installs the MCP server and a `linkedin-ads-analysis` skill. The skill tells
Claude how to read the numbers: clicks versus landing-page clicks, form leads
versus website conversions, why demographic rows don't add up, and when a
cost per lead rests on too few leads to plan on.

## CLI

```bash
npx linkedin-ads-readonly-mcp accounts
npx linkedin-ads-readonly-mcp campaigns --status ACTIVE,PAUSED
npx linkedin-ads-readonly-mcp performance --level creative --days 14
npx linkedin-ads-readonly-mcp performance --granularity monthly --since 2026-01-01 --csv > monthly.csv
npx linkedin-ads-readonly-mcp demographics seniority --campaign 500000001
npx linkedin-ads-readonly-mcp creatives --campaign 500000001
npx linkedin-ads-readonly-mcp forms --since 2026-08-01
npx linkedin-ads-readonly-mcp targeting 500000001
npx linkedin-ads-readonly-mcp lookup titles "revenue operations"
npx linkedin-ads-readonly-mcp resolve urn:li:seniority:6 urn:li:title:1
```

Installed globally (`npm i -g linkedin-ads-readonly-mcp`), the command is
`linkedin-ads`. Every command takes `--account <id>`, `--json` and `--csv`.

## Demographics

```
$ npx linkedin-ads-readonly-mcp demographics job_title --since 2026-08-01 --until 2026-08-31 --limit 5

Delivery by job title, 2026-08-01 to 2026-08-31: 244,580 impressions in total (spend in USD)

job title                  impr  share  clicks    ctr   spend  lp clicks  leads
Operations Manager       31,200  12.8%     214  0.69%  701.40         61      9
Chief Financial Officer  22,950   9.4%      96  0.42%  512.85         40      6
Controller               18,410   7.5%     120  0.65%  398.20         37      5
Director of Operations   15,300   6.3%      88  0.58%  341.10         22      4
Finance Manager           9,870   4.0%      41  0.42%  207.60         12      1

Top 5 of 214 values by impressions.
LinkedIn leaves out values with very small counts to protect member privacy. A value that is missing here is withheld or had no delivery; it is not zero.
Members can match several values (more than one title, industry or company), so rows can add up to more than the total. Read each row as a share of all impressions; do not sum them.
```

*Illustrative output with made-up titles and numbers (run `node examples/sample-demographics.mjs`).*

Breakdowns: `job_title`, `job_function`, `seniority`, `industry`,
`company_size`, `company`, `country`, `region`. Some of them come back from
LinkedIn with impressions only; when a whole column is missing, it is shown
blank with a note, not as zeros.

## Reading the numbers

- **Spend** is in the ad account's currency (`costInLocalCurrency`).
- **`clicks`** is every click on the ad. **`lp clicks`** are clicks to your
  landing page. **CPC** is spend over all clicks; the JSON output also has
  `costPerLandingPageClick`.
- **`leads`** are LinkedIn lead gen form submissions. **`conv`** are website
  conversions tracked by the Insight Tag or Conversions API. **CPL** is spend
  over form leads.
- **Form completion** is leads over form opens.
- **Dates** are inclusive on both ends. The default `until` is today's date in UTC.

## Library

```js
import { performance, demographics } from 'linkedin-ads-readonly-mcp';

const p = await performance({ account: '123456789', level: 'campaign', since: '2026-08-01', until: '2026-08-31' });
const d = await demographics({ account: '123456789', pivot: 'seniority', since: '2026-08-01' });
```

## Limits

- Read-only by design. There is no way to change budgets, bids or status here.
- Lead details are out of scope. Counts come from ad analytics; individual
  leads stay in Campaign Manager or your CRM sync.
- Listing lead forms can need an extra lead-sync permission on some apps.
  Without it, forms that creatives point at still appear by id, with counts.
- Message ads (Sponsored Messaging) are listed, but their message text is not
  fetched.
- LinkedIn caps how many rows one analytics response can hold. A daily
  breakdown by creative over many months can hit it; narrow the range.
- LinkedIn rate-limits the Marketing API per app and per member per day. This
  tool retries on 429 and 5xx with backoff, and does not cache.
- Tokens expire after 60 days. Refreshing them is up to your app.

## License

MIT
