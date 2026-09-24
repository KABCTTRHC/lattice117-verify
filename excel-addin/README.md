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

## Sideloading for development

Office refuses plain HTTP for anything but localhost, so serve over HTTPS:

```sh
cd excel-addin
npx http-server -S -p 3000
```

Then in Excel: **File → Options → Trust Center → Trust Center Settings →
Trusted Add-in Catalogs**, add the folder containing `manifest.xml`, tick
*Show in Menu*, restart Excel, and pick it from **Insert → My Add-ins →
Shared Folder**.

## Before an AppSource listing

- Regenerate the `<Id>` GUID in `manifest.xml`. It is the add-in's identity.
- Replace every `https://localhost:3000` with the public HTTPS origin.
- Validate: `npx office-addin-manifest validate manifest.xml`

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
