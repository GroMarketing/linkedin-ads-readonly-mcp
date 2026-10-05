import { ApiError, env, getJson } from './http.mjs';

const HINT = 'Create an access token with the r_ads and r_ads_reporting scopes (a LinkedIn developer app with Advertising API access) and export LINKEDIN_ACCESS_TOKEN. See the README.';
export const DEFAULT_VERSION = '202609';

/**
 * A GET-only LinkedIn Marketing API client. There is no post/put/delete here on purpose:
 * this package cannot change anything in an ad account.
 */
export function linkedinClient({ fetchImpl } = {}) {
  const token = env('LINKEDIN_ACCESS_TOKEN', HINT);
  const version = process.env.LINKEDIN_API_VERSION || DEFAULT_VERSION;
  const headers = {
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': version,
    'X-Restli-Protocol-Version': '2.0.0',
  };
  // Rest.li queries carry their own syntax (List(...), (start:(...))), so paths arrive pre-built.
  const get = async (path) => {
    try {
      return await getJson('LinkedIn', `https://api.linkedin.com/rest/${path}`, { headers, fetchImpl });
    } catch (e) {
      throw explain(e, version);
    }
  };
  return { get, version };
}

/** Turn the API errors people actually hit into a sentence that says what to change. */
function explain(e, version) {
  if (!(e instanceof ApiError)) return e;
  const add = (hint) => Object.assign(new Error(`${e.message}\n${hint}`), { status: e.status, platform: e.platform });
  if (e.status === 426 || /NONEXISTENT_VERSION/.test(e.message)) {
    return add(`LinkedIn no longer serves API version ${version}. Versions are retired about a year after release. Set LINKEDIN_API_VERSION to a recent month, e.g. ${DEFAULT_VERSION}.`);
  }
  if (e.status === 401) return add('The access token is invalid or expired. LinkedIn access tokens last 60 days; refresh or create a new one.');
  if (e.status === 403) return add('The token is valid but not allowed to read this. Check that it has r_ads and r_ads_reporting, and that your user has a role on the ad account.');
  return e;
}

/** Accept 123456789 or urn:li:sponsoredAccount:123456789; fall back to LINKEDIN_AD_ACCOUNT_ID. */
export function accountId(account) {
  const raw = String(account || process.env.LINKEDIN_AD_ACCOUNT_ID || '').trim();
  const id = raw.split(':').pop();
  if (!id) throw new Error('No ad account given. Pass an account id, or set LINKEDIN_AD_ACCOUNT_ID. `accounts` lists the ones your token can read.');
  if (!/^\d+$/.test(id)) throw new Error(`"${raw}" is not a LinkedIn ad account id (digits, or urn:li:sponsoredAccount:<digits>).`);
  return id;
}

/** Strip a URN down to its id: urn:li:sponsoredCampaign:123 -> "123". */
export const idOf = (v) => String(v ?? '').split(':').pop();

/**
 * A campaign, group or creative id from user input: digits, or a well-formed URN
 * such as urn:li:sponsoredCampaign:123. Anything else is rejected, because the id
 * ends up in a URL path or a Rest.li query.
 */
export function numericId(v, what = 'id') {
  const s = String(v ?? '').trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/^urn:li:[A-Za-z]+:(\d+)$/);
  if (m) return m[1];
  throw new Error(`"${s}" is not a valid ${what} (digits, or urn:li:<type>:<digits>).`);
}

/** Every element of a q=search / q=criteria finder, following nextPageToken. */
export async function allPages(api, path, { pageSize = 100, max = 5000 } = {}) {
  const out = [];
  let token = '';
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await api.get(`${path}${sep}pageSize=${pageSize}${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
    out.push(...(page.elements || []));
    token = page.metadata?.nextPageToken;
    if (!token || !page.elements?.length || out.length >= max) break;
  }
  return out;
}

/** Every element of an older start/count finder (lead forms), following paging.total. */
export async function allOffsetPages(api, path, { count = 100, max = 5000 } = {}) {
  const out = [];
  for (let start = 0; ; start += count) {
    const page = await api.get(`${path}&start=${start}&count=${count}`);
    const els = page.elements || [];
    out.push(...els);
    const total = page.paging?.total;
    if (els.length < count || (total != null && out.length >= total) || out.length >= max) break;
  }
  return out;
}
