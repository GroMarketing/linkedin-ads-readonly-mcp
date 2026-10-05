---
name: linkedin-ads-analysis
description: Read LinkedIn Ads data - accounts, campaign groups, campaigns, performance (spend, impressions, clicks, landing-page clicks, leads, conversions, CTR, CPC, CPM, CPL), audience demographics by job title, seniority, industry, company size or country, creatives, lead form counts and targeting - and report it honestly. Use when someone asks how their LinkedIn campaigns are doing, who their ads reach, what a campaign targets, or what a lead costs. Read-only.
---

# linkedin-ads-analysis

Use the `linkedin-ads` MCP tools if connected, otherwise the CLI
(`npx linkedin-ads-readonly-mcp ...`). Nothing here can change an account.

| Need | Tool / command |
|---|---|
| Which account id to use | `list_ad_accounts` / `linkedin-ads accounts` |
| What is running, budgets, bids | `list_campaigns` / `linkedin-ads campaigns --status ACTIVE` |
| Results over a period | `get_performance` / `linkedin-ads performance --since 2026-08-01 --until 2026-08-31` |
| Trend | `get_performance` with `granularity: daily` or `monthly` |
| Which ad is working | `get_performance` with `level: creative`, then `list_creatives` for the copy |
| Who the ads reached | `get_demographics` / `linkedin-ads demographics job_title` |
| Lead form results | `list_lead_forms` / `linkedin-ads forms` |
| What a campaign targets | `get_campaign_targeting` / `linkedin-ads targeting <id>` |
| An unknown `urn:li:...` | `resolve_targeting_urns` / `linkedin-ads resolve <urn>` |

## Read the numbers honestly

- **`clicks` is every click on the ad**, including profile, "see more" and
  video expands. **`landingPageClicks`** are clicks to the site. For traffic
  campaigns, judge cost per landing-page click, not CPC.
- **`leads` are lead gen form submissions** (`oneClickLeads`). Website
  conversions (`conversions`) only count if a conversion is set up and
  attributed to the campaign. Don't add the two together without saying so.
- **Demographics are approximate and partial.** LinkedIn withholds values with
  very small counts, so a missing title or company is withheld, not zero.
  Members match several values, so rows can sum to more than the total: use the
  `share` column, never a sum. Some breakdowns come back with impressions only;
  blank spend or clicks there means "not reported".
- **Only entities with delivery appear in performance.** A campaign missing
  from the table spent nothing in that range.
- **"no bid set"** on a campaign means no optimization target and no unit
  cost. For a deeper check of whether a campaign can serve at all, use the
  separate `ad-preflight` tool.
- **Lead details are out of scope.** This tool returns counts only and never
  fetches names, emails or answers. Don't ask it for them.

## Report

Lead with the answer (spend, results, cost per result for the period asked),
then a short table. Name the date range and currency. Call out small samples:
a CPL from 3 leads is not a CPL you can plan on.
