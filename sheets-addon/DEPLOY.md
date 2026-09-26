# Deploying the Sheets add-on with clasp

Three files reach Apps Script: `appsscript.json`, `Code.gs`, `Sidebar.html`.
`.claspignore` excludes everything else — the bundler, its template, and the
listing copy must not be pushed into a project that goes to Google for review.

`Sidebar.html` is **generated**. Never edit it directly; edit
`sidebar.template.html` or the shared modules and rebuild.

## One-time setup

```sh
npm install -g @google/clasp
clasp login                      # opens a browser; authorises your Google account
```

Enable the Apps Script API once, at https://script.google.com/home/usersettings

## Create the project (first time only)

```sh
cd sheets-addon
clasp create --type sheets --title "Lattice117 Schedule Check"
```

That writes `.clasp.json` with the real `scriptId`. If you already have a
project, copy `.clasp.json.example` to `.clasp.json` and paste the id from the
Apps Script editor URL:
`https://script.google.com/home/projects/<SCRIPT_ID>/edit`

**`.clasp.json` is not committed** — it is local configuration and the scriptId
is account-specific. `.clasp.json.example` is the committed template.

## Every deploy

```sh
cd sheets-addon
node build.mjs                   # regenerate Sidebar.html from the shared modules
node build.mjs --check           # must print "current" — CI runs this too
node ../tests/sheets.test.mjs    # bundle parity, scope assertions, digest parity
clasp push                       # upload the three files
clasp deploy --description "v0.2.0 — shared canonicalisation"
```

`clasp push` uploads; `clasp deploy` creates a numbered, immutable version. Only
a deployed version can be attached to a Workspace Marketplace listing — pushing
alone changes nothing for users.

To list what exists:

```sh
clasp deployments
clasp versions
```

## Testing before submission

```sh
clasp open
```

Then in the Apps Script editor: **Deploy → Test deployments → Install**, open any
Google Sheet, and find the add-on under **Extensions**. Test with
`demo/example-rota.csv` pasted into a sheet; the rota digest must read
`83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf`.

## Marketplace submission

The add-on requests exactly one scope, `spreadsheets.currentonly`, which is a
**non-sensitive** scope — it grants access only to the spreadsheet the user has
open, never to their Drive. That is the whole reason the OAuth review is short:
there is no restricted-scope security assessment to pass.

Order of operations:

1. `clasp deploy` — note the deployment id.
2. Google Cloud console → the project linked to the script → **OAuth consent
   screen**: set app name, support email, developer contact, and the privacy
   policy and terms URLs. Reuse the Excel add-in's pages:
   - privacy: `https://kabcttrhc.github.io/lattice117-verify/excel-addin/privacy.html`
   - support: `https://kabcttrhc.github.io/lattice117-verify/excel-addin/support.html`
3. Enable the **Google Workspace Marketplace SDK** on that project.
4. Marketplace SDK → **App Configuration**: paste the deployment id, tick Sheets
   add-on, and list the single scope.
5. Marketplace SDK → **Store Listing**: copy from `WORKSPACE-LISTING.md`.
   Graphics required — 128×128 app icon, 220×140 small promo tile, and at least
   one 1280×800 screenshot.
6. Submit for review.

`WORKSPACE-LISTING.md` holds the store copy and the justification text for the
scope question.
