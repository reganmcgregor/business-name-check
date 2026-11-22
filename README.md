# business-name-check

Check whether a business or brand name is already taken, on the official business registers and trade mark registers of Australia, New Zealand, the UK and the US, and whether matching domain names are registered.

Give it a name. It prints exact and close matches from each register, with a link to the official record. It can also print JSON, so an AI agent, a script or an n8n workflow can call it.

```bash
npx business-name-check "Heat & Chill"
```

It needs Node 20.12 or newer, has no dependencies, and runs with no API keys at all. Registers that need a key skip themselves with a message saying where to get one.

> **A register match is not a trade mark clearance, and no match does not mean a name is safe.** This tool does not search every register, trade mark registers are only partly covered, and similar-sounding or similar-looking names can still be a problem. Use it as a quick first filter, then get advice from a trade mark attorney before you commit to a name.

## What it covers

| Country | Register | Type | Key | Status |
| --- | --- | --- | --- | --- |
| Australia | ASIC business names (via data.gov.au) | Business names | None | Works with no key |
| Australia | ASIC company register (via data.gov.au) | Companies | None | Works with no key |
| Australia | ABN Lookup (ABR) | Entity, business and trading names | Free GUID | Needs key |
| Australia | IP Australia | Trade marks (live marks only) | Free client ID and secret | Needs key (see notes) |
| United Kingdom | Companies House | Companies and LLPs | Free API key | Needs key |
| New Zealand | NZBN register | Companies, trusts, sole traders with an NZBN | Free subscription key | Needs key (not yet run against a live key) |
| United States | SEC EDGAR company list | SEC registrants only | Your own User-Agent string | Needs a contact string |
| United States | NY, CO, CT, OR, PA, DC and TX open data | Business registers of those states, plus DC trade names and Texas franchise-tax and sales-tax accounts | None | Works with no key |
| All | Domain names (RDAP, WHOIS for .nz) | `.com`, plus `.com.au`, `.co.nz`, `.co.uk` for the countries you pick | None | Works with no key |

### What it does not cover

These registers have no open search API, so the tool prints a link for you to check by hand instead:

- **UK IPO trade marks.** The search site blocks automated access with a captcha, and there is no public API.
- **IPONZ (NZ trade marks).** IPONZ does offer a trade mark search API (`POST /trademarksearch`), through the same MBIE developer portal as the NZBN. You subscribe with your RealMe login, and the endpoint definition is only visible once you are signed in, so it is not scripted here yet. Pull requests welcome if you have access.
- **USPTO trade marks.** The USPTO's open APIs cover case status by serial number and bulk downloads, not name search. Its search website runs on an internal backend that is not a published API. Some third-party tools call that backend or run their own index. This tool does not, because those routes are unofficial and can change or disappear without notice. Search the USPTO by hand at the link the tool prints.
- **Most US state registers.** There is no national US business register. The tool covers the states and districts that publish business data as free open data: New York, Colorado, Connecticut, Oregon, Pennsylvania, the District of Columbia and Texas. Two of those are partial. Pennsylvania lists active registrations only, and the Texas data comes from the Comptroller (franchise-tax and sales-tax accounts), so sole proprietors, most general partnerships and assumed names are missing, and the status codes are read as A active, R revoked and F forfeited. Delaware, California, Florida and the rest have no free name-search API (most sell bulk files, or use captchas), so you get links to check by hand instead: a pre-filled results page for Florida, landing pages for a dozen other large states, and the NASS directory for the rest. Many of those sites block scripts or show a captcha, which is why the tool does not open them for you. OpenCorporates aggregates many state registers, but it is a paid API with internal-use licence terms, so it is not included.

Also not covered: common-law (unregistered) trade mark use, social handles, company names in countries other than the four above, and sound-alike or meaning-alike names.

Notes on the registers that need a key:

- **IP Australia** gives you a client ID and secret once you create an application on their developer portal and request access to the Australian Trade Mark Search API. The portal's own text says approval can take a few days, but mine was approved on the spot. The tool searches registered and pending marks only (removed and lapsed marks are left out). The search returns trade mark numbers, so the tool then fetches each record, newest first, up to 60 by default (raise it with `--limit`). When a name has more live marks than that, the output says how many it checked.
- **ASIC data** comes from the ASIC business names and company datasets on data.gov.au, published by ASIC under a [Creative Commons Attribution 3.0 Australia](https://creativecommons.org/licenses/by/3.0/au/) licence. They are updated about weekly, so very new registrations may not appear yet.
- **SEC EDGAR** has no name-search API. The tool downloads the SEC's public company list once a day and filters it locally. The SEC asks every automated client to identify itself with a name and email in the User-Agent, so the tool asks you for yours rather than inventing one.

### Domain names

Every run also checks whether matching domains are registered, because a name you cannot get a domain for is a different problem from a name someone else has registered. It tries two spellings (with "&" read as "and", and with it dropped), on `.com` plus the local ending for each country you pick (`.com.au`, `.co.nz`, `.co.uk`).

It asks each registry directly: RDAP, using the IANA bootstrap list to find the right server, and WHOIS for `.nz`, which has no RDAP service. Results are `registered`, `not_found` or `unknown`. This is a weaker signal than a register match:

- A domain that is not found may still be reserved, premium or about to be released, so the tool never says "available".
- `.com.au` needs an Australian connection, such as an ABN.
- A taken domain does not mean the name is taken as a business or trade mark.

Choose the endings yourself with `--domains com,shop,store`, or skip the check with `--no-domains`.

## Install and usage

```bash
# Run without installing (from npm)
npx business-name-check "Heat & Chill"

# Or straight from GitHub
npx github:reganmcgregor/business-name-check "Heat & Chill"

# Or install it globally
npm install -g business-name-check

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
      --no-domains       Skip the domain name checks
      --domains <list>   Domain endings to check instead of the defaults, e.g. com,com.au,shop
      --exit-code        Exit 1 on an active exact match, 3 if a register failed (default is always 0)
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

Records that are cancelled, deregistered or dissolved are labelled `(inactive)` and counted apart from active ones. An inactive exact match is still worth knowing about, because a name can be re-registered or revived.

### JSON output

`--json` prints one object:

- `query`, `normalised`, `checkedAt`, `countries`.
- `results`: one entry per register. `status` is `ok`, `skipped` or `error`, and skipped or failed registers carry a `reason`. Each entry has `matches`, where every match has `name`, `match` (`exact`, `close` or `related`), `status`, `active` (`true`, `false` or `null` when unknown), `type`, `id`, `url` and a register-specific `details` object. A `note` says when a register was only partly searched.
- `summary`: per country, `registersTotal`, `registersChecked`, `registersSkipped`, `registersFailed`, `tradeMarksChecked`, `complete`, and counts of active `exact` and `close` matches plus `inactiveExact`. Agents should read `complete` and `tradeMarksChecked` before reporting a name as clear. A summary with nothing found is not a clearance.
- `manual`: links to registers you must check by hand.
- `domains`: `{ domain, tld, status, source }` for each domain checked, kept apart from `results` because it is a weaker signal. `domainNote` explains the limits.
- `disclaimer`.

With `--exit-code` the process exits 1 when any active exact match is found, 3 when a register failed and nothing was found, and 0 otherwise. Usage errors always exit 2.

### From n8n or another tool

Run it with the Execute Command node (or any shell step) and parse the JSON:

```bash
npx business-name-check "{{ $json.name }}" --country au --json
```

You can also import it as a module: `import { checkName } from 'business-name-check'`.

## Getting keys

Copy `.env.example` to `.env` and fill in what you have, or run `business-name-check --setup` to be prompted with hidden input. Setup saves `.env` (owner-only permissions) and tests each key against its register. Real keys are never committed: `.env` is in `.gitignore`.

| Variable | Where to get it |
| --- | --- |
| `ABR_GUID` | Register at [abr.business.gov.au/Tools/WebServices](https://abr.business.gov.au/Tools/WebServices). Free. The GUID is emailed to you. |
| `IPA_CLIENT_ID`, `IPA_CLIENT_SECRET` | Register on the [IP Australia API developer portal](https://portal.api.ipaustralia.gov.au/s/), create a client application (choose the Production environment), then use Request Access on the Australian Trade Mark Search API page. Free. The client ID and secret are shown once when you create the application, so save them straight away. Set `IPA_ENV=test` to use their test environment. |
| `COMPANIES_HOUSE_API_KEY` | Create an account on the [Companies House developer hub](https://developer.company-information.service.gov.uk/), register an application and create a REST key. Free. |
| `NZBN_SUBSCRIPTION_KEY` | Sign up on the [NZBN API portal](https://portal.api.business.govt.nz/) and subscribe to the NZBN API product. Free, approval can take a short while. Set `NZBN_ENV=sandbox` to use the sandbox. |
| `SEC_USER_AGENT` | Your own name and email, for example `Your Name you@example.com`. See the [SEC's access rules](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data). |

## Fair use and rate limits

The tool is a polite client: it waits at least 250 ms between requests to the same host (change it with `BNC_MIN_DELAY_MS`), retries on HTTP 429 and 502 to 504 with the server's `Retry-After` or a backoff, and sends an identifying User-Agent. Each run makes a handful of requests per register.

| Register | Limit to be aware of |
| --- | --- |
| Companies House | 600 requests per 5 minutes per key. |
| SEC EDGAR | 10 requests per second, and a descriptive User-Agent is required. The company list is cached for 24 hours in your temp folder. |
| ABN Lookup | Fair use under the terms you accept when you register for the GUID. Do not hammer it. |
| NZBN | Throttled per subscription. Retries on 429. |
| IP Australia | 600 requests per minute on the base tier. Each run makes up to about 60 record fetches. |
| RDAP and WHOIS (domains) | No published limits. A run makes about eight lookups across four registry servers. `.nz` WHOIS is for single queries only, so no bulk use. auDA (`.com.au`) rate-limits hard: repeated runs in a burst can get an IP blocked for hours, and the tool then reports that domain as "could not check". |
| US state open data | Keyless requests to the Socrata portals are throttled per IP. Set `SOCRATA_APP_TOKEN` (free from each portal) if you hit limits. DC's ArcGIS service publishes no limit, so requests go one at a time. |
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
