# Google Workspace Marketplace — listing, scopes and deployment

## 1. Store listing

**Name** — `Lattice117 Schedule Check`

**Short description** (max 300)
> Check whether your delivery rounds can actually be run against their own time
> windows, and whether your staff rota meets 11-hour rest and 20-minute break
> thresholds. Everything computes inside the sidebar — your sheet is never sent
> to us, and the add-on cannot reach the internet.

**Detailed description**

> It is easy to find out whether a planner produced a route, or whether a rota
> covers every shift. It is surprisingly hard to find out whether either one is
> actually possible.
>
> **Fleet routes.** Select your rows, including the header, and Lattice117
> reports what proportion of your rounds are achievable against their own time
> windows. Where one is not, it names the stop, the arrival time, when the
> window shuts and by how much it is missed.
>
> **UK staff rotas.** Point it at a shift roster and it checks the gap between
> each person's consecutive shifts against an 11-hour rest threshold, and any
> shift over six hours against a 20-minute break. It names the staff member,
> the shift pair, the rest actually achieved and the exact shortfall. Night
> shifts running past midnight are handled correctly.
>
> This is an **indicative mathematical check against the thresholds you
> configure. It is not legal advice**, and it knows nothing of opt-outs, young
> workers, compensatory rest or any collective agreement. A clear result is not
> a defence and a flagged result is not an offence.
>
> Breaching rows are coloured in the sheet, where you are already looking.
>
> **Your column names do not matter.** They are matched from your header row,
> whatever you call them, so a normal rota or TMS export works with no
> preparation.
>
> **The same answer, everywhere.** All arithmetic is fixed-point, so the verdict
> is bit-identical on any machine, every run. The paid tier adds a reproducible
> SHA-256 over the inputs and the result, so a third party can re-compute your
> verdict and confirm they got the same one. That digest is identical in Google
> Sheets, Excel, the browser and the npm package — the same engine runs in all
> four.

**Category** — Productivity
**Search terms** — rota, shift planning, working time, rest break, 11 hour rest,
schedule, route, fleet, logistics, care home rota, hospitality rota, feasibility,
audit, offline

---

## 2. For Google's OAuth review team

**Requested scope, in full:**

```
https://www.googleapis.com/auth/spreadsheets.currentonly
```

That is the entire list. There is no second scope.

**Why this scope and not `spreadsheets`.** The add-on only ever reads the
sheet the user has open and writes a background colour back to rows in that
same sheet. `spreadsheets.currentonly` grants exactly that and nothing more —
it cannot open, list or read any other file in the user's Drive. We ask for the
narrowest scope that lets the feature work.

**Why there is no `script.external_request` scope and no `urlFetchWhitelist`.**
The add-on makes no network requests at all. `Code.gs` contains no
`UrlFetchApp`, no `DriveApp`, no `PropertiesService` and no `CacheService` — a
repository test asserts their absence on every commit rather than leaving it as
a claim. The verification engine is a 21 KB WebAssembly module inlined into the
sidebar as base64, so there is nothing for it to download either.

**What the sidebar receives.** `Code.gs` calls `getDisplayValues()` and returns
a grid of plain strings. Nothing is stored, logged or transmitted. When the
sidebar is closed, nothing persists except a licence key the user pasted, which
lives in that browser's local storage and is verified offline by public-key
signature.

**Data handling summary for the verification form:**

| Question | Answer |
|---|---|
| Does the add-on transmit user data off-device? | No |
| Does it store user data? | No. A licence key, if entered, stays in browser local storage |
| Does it use Google user data for advertising? | No |
| Does it share data with third parties? | No |
| Does it make external network requests? | No — verified by test, and no scope permits it |

Privacy policy:
`https://kabcttrhc.github.io/lattice117-verify/excel-addin/privacy.html`
Support: `https://kabcttrhc.github.io/lattice117-verify/excel-addin/support.html`

---

## 3. Deployment

`Sidebar.html` is generated. Never edit it by hand — edit
`sidebar.template.html` or the shared modules in `demo/`, then rebuild:

```sh
node sheets-addon/build.mjs          # writes Sidebar.html
node sheets-addon/build.mjs --check  # CI: fails if the committed file is stale
```

### First-time setup

```sh
npm install -g @google/clasp
clasp login
```

### Create and push the project

```sh
cd sheets-addon
clasp create --type sheets --title "Lattice117 Schedule Check"
clasp push          # uploads Code.gs, Sidebar.html and appsscript.json
clasp open          # opens the Apps Script editor
```

`clasp` uploads `.html` and `.gs` files from this directory. `build.mjs` and
the template are development files — exclude them with a `.claspignore`:

```
build.mjs
sidebar.template.html
WORKSPACE-LISTING.md
*.md
```

### Test before publishing

1. In the Apps Script editor: **Deploy → Test deployments → Install**.
2. Open any sheet, then **Extensions → Lattice117 → Schedule check**.
3. Paste a route sheet or a rota, select the rows including the header, and run.

Google's OAuth consent screen will warn that the app is unverified until review
completes. That is expected for a test deployment.

### Publish

1. **Deploy → New deployment → Add-on.**
2. Google Cloud console → **OAuth consent screen**: fill in the app name, the
   support email, the privacy and terms URLs, and submit for verification.
3. Google Workspace Marketplace SDK → configure the store listing using §1,
   upload icons and screenshots, and submit.

Review typically takes a few weeks, and the scope list above is the thing that
makes it short rather than long.

---

## 4. Honest architecture note

The sidebar HTML itself is served by Google's Apps Script runtime from a
sandboxed `googleusercontent.com` iframe. That is Google delivering the page,
not Lattice117 — we operate no server and receive nothing.

Once the sidebar has loaded, every part of the work happens inside that iframe
on your machine: parsing the grid, the Q16.16 fixed-point evaluation in
WebAssembly, the rest and break arithmetic, the SHA-256 digest and the licence
check. Zero network requests are made to Brierley Sovereign Group Ltd at any
point, and the add-on holds no scope that would permit one.

This differs from the Excel task pane in exactly one respect worth stating:
the Excel pane is served from GitHub Pages and is fully offline-capable via a
service worker, so it keeps working with the network disconnected. The Sheets
sidebar is delivered by Google each time it is opened, so it needs a connection
to *open* — but not to *compute*. Both are equally local once running.
