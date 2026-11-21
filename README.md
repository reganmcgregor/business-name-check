# business-name-check

Check whether a business or brand name is already taken, on the official business registers and trade mark registers of Australia, New Zealand, the UK and the US.

Give it a name. It prints exact and close matches from each register, with a link to the official record. It can also print JSON, so an AI agent, a script or an n8n workflow can call it.

```bash
npx github:reganmcgregor/business-name-check "Heat & Chill"
```

It needs Node 20.12 or newer, has no dependencies, and runs with no API keys at all. Registers that need a key skip themselves with a message saying where to get one.

> **A register match is not a trade mark clearance, and no match does not mean a name is safe.** This tool does not search every register, trade mark registers are only partly covered, and similar-sounding or similar-looking names can still be a problem. Use it as a quick first filter, then get advice from a trade mark attorney before you commit to a name.

## What it covers

| Country | Register | Type | Key | Status |
| --- | --- | --- | --- | --- |
| Australia | ASIC business names (via data.gov.au) | Business names | None | Works with no key |
| Australia | ASIC company register (via data.gov.au) | Companies | None | Works with no key |
| Australia | ABN Lookup (ABR) | Entity, business and trading names | Free GUID | Needs key |
| Australia | IP Australia | Trade marks | Free client ID and secret | Needs key (see notes) |
| United Kingdom | Companies House | Companies and LLPs | Free API key | Needs key |
| New Zealand | NZBN register | Companies, trusts, sole traders with an NZBN | Free subscription key | Needs key |
| United States | SEC EDGAR company list | SEC registrants only | Your own User-Agent string | Needs a contact string |
| United States | OpenCorporates | State registers, aggregated | Token | Needs key (see notes) |

### What it does not cover

These registers have no open search API, so the tool prints a link for you to check by hand instead:

- **UK IPO trade marks.** The search site blocks automated access with a captcha, and there is no public API.
- **IPONZ (NZ trade marks).** No public search API.
- **USPTO trade marks.** The USPTO's open APIs cover case status and bulk downloads, not name search. Its search site is not an open API.
- **US state registers.** There is no national US business register. Each state runs its own, and most (including Delaware) have no free API and use captchas. OpenCorporates aggregates many of them, but it is a third party and not complete. The tool links to the NASS directory so you can find the right state.

Also not covered: common-law (unregistered) trade mark use, domain names, social handles, company names in countries other than the four above, and sound-alike or meaning-alike names.

Notes on the registers that need a key:

- **IP Australia** issues API credentials after a manual approval that can take up to 3 business days. The adapter is written against IP Australia's published API description and has been verified only when credentials are available, so please open an issue if the response shape has changed.
- **SEC EDGAR** has no name-search API. The tool downloads the SEC's public company list once a day and filters it locally. The SEC asks every automated client to identify itself with a name and email in the User-Agent, so the tool asks you for yours rather than inventing one.
- **OpenCorporates** gives free keys to public-benefit and open-data users. Commercial use needs a paid plan. Check their terms before you use it.

## Install and usage

```bash
# Run without installing
npx github:reganmcgregor/business-name-check "Heat & Chill"

# Or clone it
git clone https://github.com/reganmcgregor/business-name-check.git
cd business-name-check
node bin/business-name-check.js "Heat & Chill" --country au
```

```text
business-name-check <name> [options]

  -c, --country <list>   au, nz, uk, us (comma separated) or all. Default: all
      --json             Print JSON instead of text
      --all              Also list loosely related results
  -l, --limit <n>        Results to request per register. Default: 25
      --env-file <path>  Load API keys from this file. Default: ./.env if present
      --setup            Prompt for API keys (hidden input) and save them to ./.env
      --list             List the registers, the keys they need and where to get them
```

Examples:

```bash
business-name-check "Brightwater" --country au,nz
business-name-check "Brightwater" --json | jq '.summary'
business-name-check --list
```

### How matches are labelled

- **EXACT**: the same name once case, punctuation, "&" versus "and", spacing and company endings (Pty Ltd, Limited, Inc, LLC) are ignored.
- **CLOSE**: one name contains the other as whole words, or the spelling is nearly identical.
- **related**: anything else the register returned. Hidden unless you pass `--all`.

### JSON output

`--json` prints one object: `query`, `normalised`, `checkedAt`, `results` (one entry per register with `status` of `ok`, `skipped` or `error`, and a `matches` array with `name`, `match`, `status`, `type`, `id`, `url`), `manual` (links to check by hand), `summary` (per country counts) and `disclaimer`. Skipped registers carry a `reason`, so an agent can see what was not checked.

### From n8n or another tool

Run it with the Execute Command node (or any shell step) and parse the JSON:

```bash
npx github:reganmcgregor/business-name-check "{{ $json.name }}" --country au --json
```

You can also import it as a module: `import { checkName } from 'business-name-check'`.

## Getting keys

Copy `.env.example` to `.env` and fill in what you have, or run `business-name-check --setup` to be prompted with hidden input. Setup saves `.env` (owner-only permissions) and tests each key against its register. Real keys are never committed: `.env` is in `.gitignore`.

| Variable | Where to get it |
| --- | --- |
| `ABR_GUID` | Register at [abr.business.gov.au/Tools/WebServices](https://abr.business.gov.au/Tools/WebServices). Free. The GUID is emailed to you. |
| `IPA_CLIENT_ID`, `IPA_CLIENT_SECRET` | Request API access on the [IP Australia developer portal](https://anypoint.mulesoft.com/exchange/portals/ip-australia-3/pages/How%20to%20Register/), then subscribe to the Australian Trade Mark Search API. Free, up to 3 business days. Set `IPA_ENV=test` to use their test environment. |
| `COMPANIES_HOUSE_API_KEY` | Create an account on the [Companies House developer hub](https://developer.company-information.service.gov.uk/), register an application and create a REST key. Free. |
| `NZBN_SUBSCRIPTION_KEY` | Sign up on the [NZBN API portal](https://portal.api.business.govt.nz/) and subscribe to the NZBN API product. Free, approval can take a short while. Set `NZBN_ENV=sandbox` to use the sandbox. |
| `SEC_USER_AGENT` | Your own name and email, for example `Your Name you@example.com`. See the [SEC's access rules](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data). |
| `OPENCORPORATES_API_TOKEN` | [OpenCorporates API accounts](https://opencorporates.com/api_accounts/new). Free for public-benefit use, paid otherwise. |

## Fair use and rate limits

The tool is a polite client: it waits at least 250 ms between requests to the same host (change it with `BNC_MIN_DELAY_MS`), retries on HTTP 429 and 502 to 504 with the server's `Retry-After` or a backoff, and sends an identifying User-Agent. Each run makes a handful of requests per register.

| Register | Limit to be aware of |
| --- | --- |
| Companies House | 600 requests per 5 minutes per key. |
| SEC EDGAR | 10 requests per second, and a descriptive User-Agent is required. The company list is cached for 24 hours in your temp folder. |
| ABN Lookup | Fair use under the terms you accept when you register for the GUID. Do not hammer it. |
| NZBN | Throttled per subscription. Retries on 429. |
| IP Australia | Per client credentials. Retries on 429. |
| OpenCorporates | Depends on your plan. |
| data.gov.au (ASIC) | No published limit. The tool makes about four requests per run. |

You are responsible for using each register within its terms. In particular, do not use results to build a bulk copy of any register.

## Development

```bash
npm test            # unit tests, no network
npm run test:live   # checks real registers; skips any register without a key
```

The live tests check one clearly taken name per country (Woolworths, Tesco, Fonterra, Walmart) and one name that is almost certainly free.

To add a register, add an adapter in `src/registers/` that exports `{ id, country, kind, label, env, search(name, env, { limit }) }`, returning `{ total, matches: [{ name, status, type, id, url }] }`, and list it in `src/index.js`.

## Licence

MIT. See [LICENSE](LICENSE).
