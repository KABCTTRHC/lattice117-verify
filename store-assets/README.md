# Store assets

Generated, not hand-made. Regenerate with:

```sh
node tools/store-assets/capture.mjs
```

| File | Size | Where it goes |
|---|---|---|
| `appsource/01-fleet-result.png` | 1366×768 | AppSource screenshot 1 |
| `appsource/02-fleet-violation-detail.png` | 1366×768 | AppSource screenshot 2 |
| `appsource/03-rota-result.png` | 1366×768 | AppSource screenshot 3 |
| `appsource/04-rota-shortfall-detail.png` | 1366×768 | AppSource screenshot 4 |
| `appsource/05-licence-and-privacy.png` | 1366×768 | AppSource screenshot 5 |
| `workspace/screenshot-1280x800.png` | 1280×800 | Workspace Marketplace screenshot |
| `workspace/icon-128.png` | 128×128 | Workspace Marketplace app icon |
| `workspace/promo-220x140.png` | 220×140 | Workspace Marketplace small promo tile |

## Read this before submitting

**These are product shots, not in-host screenshots.** Every panel is the real
page loaded live in an iframe and driven by the repository's own fixtures — the
verdicts, the row counts and the digests on screen are computed at capture time
by the shipping WASM engine, and the rota digest reads
`83c66e6d…`, the same value the white paper cites. But nothing here imitates
Excel or Google Sheets chrome, because fabricating a host application's UI in a
store listing is a misrepresentation regardless of how good it looks.

**Microsoft's reviewers generally expect to see the add-in inside Excel.** So
treat `appsource/*` as strong listing art and as a baseline, and retake at least
screenshots 1 and 3 from your own laptop with the add-in sideloaded and a real
sheet open. Google is more relaxed about product shots, so
`workspace/screenshot-1280x800.png` is likely submittable as-is.

**They are captured on the Pro tier, deliberately.** On the free tier the pane
reads "100% rounds achievable" having checked 1 of 8 rounds, greys out the
certificate button and masks the digest — an accurate screenshot of a state that
*looks* misleading, and exactly what a reviewer flags as a fault. The capture
mints a short-lived Pro licence from `licence/keypair.json` at run time. That
file holds the private key and is gitignored, so no key is committed and nobody
who should not be able to mint licences can regenerate these. Without it the
script still runs, warns, and captures the free tier.

**What is still missing for AppSource**, from `excel-addin/APPSOURCE-LISTING.md`:
a Partner Center account in the company's name, test instructions plus a
reviewer Pro key, and — if you want them — a short video of the offline
demonstration.
