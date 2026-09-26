# AppSource listing copy, and the Google Sheets port

Everything Partner Center asks for, written out so submission is copy-and-paste.
Nothing here is aspirational: each claim matches something the add-in actually
does today.

---

## 1. Listing fields

**Name** (30 max) — `Lattice117 Schedule Check`

**Short description** (100 max, 99 used)
> Check routes and staff rotas against their own limits. Nothing leaves your workbook.

**Description** (matches `manifest.xml`, 235 chars)
> Checks whether your rounds can be run against their own time windows, and
> whether your rota meets 11h rest and 20m break thresholds. Names what breaks
> and by how much. Runs entirely inside Excel - nothing is uploaded.

**Long description**

> It is easy to find out whether a planner produced a route, or whether a rota
> covers every shift. It is surprisingly hard to find out whether either one is
> actually possible.
>
> Schedule Check answers both, in two modes.
>
> **Fleet routes.** Select your rows, including the header, and it reports what
> proportion of your rounds are actually achievable against their own time
> windows. Where one is not, it names the stop, the arrival time, when the
> window shuts and by how much it is missed.
>
> **UK staff rotas.** Point it at a shift roster and it checks the gap between
> consecutive shifts for each person against an 11-hour rest threshold, and any
> shift over six hours against a 20-minute break. It names the staff member,
> the shift pair, the rest actually achieved and the exact shortfall. Night
> shifts that run past midnight are handled correctly. This is an indicative
> mathematical check against the thresholds you configure — it is not legal
> advice, and it knows nothing of opt-outs, young workers or compensatory rest.
>
> Either way, the failing rows are coloured in the sheet, where you are already
> looking, and times written as Excel time cells are read correctly rather than
> as raw serial numbers.
>
> **Nothing leaves your workbook.** The engine is a 21 KB WebAssembly module
> that computes inside Excel's own task-pane process. There is no upload, no
> account and no API call. Disconnect from the network entirely and it still
> works — which is the simplest way to confirm the claim rather than take it on
> trust. For anyone whose schedules contain customer addresses or staff names,
> that removes the data-processing agreement, the security review and the GDPR
> conversation from the decision.
>
> **Your column names do not matter.** They are matched from your header row,
> whatever you call them. A normal TMS or rota export works with no preparation.
>
> **The same answer, everywhere.** All arithmetic is fixed-point, so the verdict
> is bit-identical on any machine, every run. Pro adds a reproducible SHA-256
> over the inputs and the verdict, so a third party can re-compute your result
> and confirm they got the same one.
>
> **What it does not do.** It verifies time windows, travel times and rest
> thresholds. It does not build routes, generate rotas, predict traffic, or
> judge whether a schedule is good — only whether it is possible. Vehicle
> capacity is not yet a hard constraint. The rota check is arithmetic against
> configured thresholds and is not a determination of compliance with the
> Working Time Regulations or any other law.

**Categories** — Productivity · Data analytics · Human resources
**Search terms** — schedule, route, rota, shift planning, working time,
rest break, 11 hour rest, logistics, fleet, feasibility, time windows,
care home rota, hospitality rota, offline, verification, audit
**Products** — Excel (Windows, Mac, Web)

**URLs**
| Field | Value |
|---|---|
| Support | `https://kabcttrhc.github.io/lattice117-verify/excel-addin/support.html` |
| Privacy policy | `https://kabcttrhc.github.io/lattice117-verify/excel-addin/privacy.html` |
| Learn more | `https://kabcttrhc.github.io/lattice117-verify/` |

## 2. What Partner Center will ask that this repo cannot answer

- **Publisher verification.** A Partner Center account in the company's name,
  matching Companies House. Submission itself is free.
- **Test instructions and a test account.** There is no account, so say so, and
  supply a Pro licence key plus the sample sheet for the reviewer. Without a
  key the reviewer sees the free tier and may report the cap as a fault.
- **Screenshots**, 1366×768. Five carry the story now that there are two
  modes: a route sheet with failing rows coloured; the pane naming the stop,
  arrival, close and deficit; a rota with breaching shifts coloured; the pane
  naming the staff member, rest achieved and shortfall; the licence panel.
  Reviewers judge the listing largely on these, and a rota screenshot is what
  a care-home or hospitality buyer searches for.
- **Video** — optional, and the offline demonstration is the one worth filming.

## 3. Before you submit

- [ ] `manifest.xml` structural checks pass (script in the commit that added this)
- [ ] Run Microsoft's own validator from your machine — this container cannot
      reach the hosted service: `npx office-addin-manifest validate manifest.xml`
- [ ] `privacy.html` and `support.html` load over HTTPS from Pages
- [ ] Sideload and run once against a real route sheet AND a real rota
- [ ] Confirm the rota mode reads Excel time cells (serial numbers), not just text
- [ ] Reviewer key issued: `node licence/issue.mjs issue <reviewer> pro 6`

---

## 4. Porting to Google Sheets — the 95% that carries over

Both hosts are a webview displaying HTML and running JavaScript. The engine,
the licence check, the digest and the column mapper are host-agnostic and move
unchanged. Only the ten-or-so lines that talk to the spreadsheet differ.

### Files that move with no edit

```
digest.js            canonicalisation — identical
licence.js           licence verification — identical
lattice117_wasm.wasm the engine — identical
```

### Structure

```
sheets-addon/
  appsscript.json     manifest: scopes + sidebar entry point
  Code.gs             server-side Apps Script — menu, sidebar, range read/write
  Sidebar.html        the pane: taskpane.html with its Excel calls swapped
```

### The only real differences

| Concern | Excel (Office.js) | Sheets (Apps Script) |
|---|---|---|
| Entry point | `Office.onReady` | `onOpen()` adds a menu item |
| Read selection | `ctx.workbook.getSelectedRange()` → `.values` | `google.script.run.getSelection()` → `getActiveRange().getValues()` |
| Write formatting | `range.format.fill.color` | `range.setBackground('#FFD7D5')` |
| Async model | promises via `Excel.run` | `google.script.run.withSuccessHandler(...)` |
| Loading the WASM | `fetch('./lattice117_wasm.wasm')` | same, but the file must be hosted — Apps Script serves no binaries, so point at the Pages URL |

**The one thing that genuinely needs care:** Apps Script's HTML service runs the
sidebar in a sandboxed iframe on a `googleusercontent.com` origin, so fetching
the WASM from `kabcttrhc.github.io` is a cross-origin request. GitHub Pages
sends `Access-Control-Allow-Origin: *`, so it works — but it means the sidebar
is *not* offline-capable the way the Excel pane is, and the privacy wording must
change accordingly: the schedule still never leaves the machine, but the engine
is fetched each session. Do not copy the Excel privacy page across unedited.

### Suggested order

1. Excel through AppSource review first — the listing copy and screenshots are
   reusable and the review feedback is free advice.
2. `Code.gs` with three functions: `onOpen`, `showSidebar`, `getSelection`.
3. `Sidebar.html` = `taskpane.html` with the table above applied.
4. Wrap the two host calls behind `readSelection()` / `highlightRows()` so both
   hosts share one file thereafter, and add it to the CI drift check.
