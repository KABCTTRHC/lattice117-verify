# Lattice117 Schedule Check — Excel add-in

Select your route rows in a sheet, click **Schedule Check**, and find out what
proportion of them can actually be run. Failing rows are coloured in the sheet
itself, and the pane names the stop, the arrival, the window close and the
deficit.

**Nothing leaves the workbook.** The verifier is 21 KB of WebAssembly that
computes inside Excel's own task-pane process. There is no API call, no
upload and no account — which removes the data-processing agreement, the
security review and the GDPR conversation from the sale entirely.

## Your sheet

One row per stop, in visit order. Column names can be anything — they are
matched from your header row:

| Duty ID | Stop No. | Delivery Point | Earliest Arrival | Latest Arrival | Drive Time (mins) |
|---|---|---|---|---|---|
| VAN-01 | 0 | DEPOT | 0 | 600 | 0 |
| VAN-01 | 1 | Bilborough | 0 | 60 | 12 |
| VAN-01 | 2 | Beeston | 0 | 90 | 18 |
| VAN-01 | 3 | Clifton | 0 | 40 | 15 |

Five columns are required: the round, the stop, when its window opens and
closes, and **travel time from the previous stop**. That last one is why no
distance matrix is needed — checking a fixed round only needs the legs you
actually drive, which is what a route sheet already contains.

A sequence column is used if present; otherwise sheet order is taken as visit
order.

## Licence

The pane uses the same ECDSA P-256 keys the browser audit uses, so one licence
covers both. Open **Licence** in the pane and paste the key.

| | Free | Licensed |
|---|---|---|
| Rounds checked per run | 1 | every round in the selection |
| Failing rows coloured | yes | yes |
| Verdict digest | — | yes |

The cap is applied where rounds are evaluated, not by hiding rows afterwards.
Verification is local: there is no account and no call home, which is the
property that lets this run on schedules an operator is not allowed to upload.
The check is open source, so it is a lock on an honest door — commercial use is
actually governed by the AGPL and the commercial licence, not by that check.

## Installing

Office refuses plain HTTP for any origin but localhost, so the pane is served
from GitHub Pages:

    https://kabcttrhc.github.io/lattice117-verify/excel-addin/

`.github/workflows/pages.yml` publishes it on every push to `main`. Enable it
once under **Settings → Pages → Source → GitHub Actions**.

To install, save `manifest.xml` to a folder, then in Excel: **File → Options →
Trust Center → Trust Center Settings → Trusted Add-in Catalogs**, add that
folder, tick *Show in Menu*, restart Excel, and pick it from **Insert → My
Add-ins → Shared Folder**.

To develop against a local server instead, swap the Pages origin in
`manifest.xml` for `https://localhost:3000` and run `npx http-server -S -p 3000`
in this folder. Office requires TLS even on localhost; `-S` generates a cert.

## Before an AppSource listing

- The `<Id>` GUID is set and must not change again — changing it makes every
  existing install look like a different add-in.
- Validate: `npx office-addin-manifest validate manifest.xml`
- AppSource requires a privacy policy URL and support URL that resolve.

## Verified behaviour

Driven headlessly against a stubbed Office.js with deliberately awkward
headers — *Duty ID, Stop No., Delivery Point, Earliest Arrival, Latest
Arrival, Drive Time (mins)* — all five columns matched with no help:

```
50% rounds achievable · 1 of 2 cannot be run as scheduled
VAN-01 misses Clifton
  arrives 45.0000 (2949120)
  shuts   40.0000 (2621440)
  late by  5.0000 (327680)
sheet row 4 highlighted
```

The licence gate is driven the same way, against the 8-round example sheet:

```
FREE   tier: free · checked 1 of 8 rounds · no digest · 0 rows coloured
PRO    tier: pro  · 3 of 8 cannot be run · digest shown · 3 rows coloured
BAD    "Not applied: signature does not verify"  (key is not stored)
RELOAD tier: pro                                 (survives a pane reload)
REMOVE tier: free
```

Those figures are identical to the ones the native CLI, the browser audit and
the npm package produce for the same schedule — because all four call the same
Rust `evaluate_order`.

## Limits worth knowing

Values are converted to Q16.16 fixed point, which represents **−32,768 to
+32,767**. In minutes that caps a schedule around 22 days; in seconds, about 9
hours. Out-of-range values are refused by name rather than wrapped — a wrapped
value produces a confident verdict about a schedule that was never checked.

It verifies time windows and travel times. It does not build routes, predict
traffic, or check vehicle capacity as a hard constraint.
