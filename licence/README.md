# Licensing

ECDSA P-256 / SHA-256, verified in the browser. No accounts, no server, no
database of customer schedules — which is the whole point, because a database
of customer schedules would destroy the one property that makes this sellable.

## Issuing a key after a payment

```sh
cd licence
node issue.mjs keygen                              # ONCE. Writes keypair.json.
node issue.mjs issue buyer@company.com pro 12      # 12 months
node issue.mjs verify <key>                        # sanity check
```

`keygen` prints the public key to paste into `licence.js`. **Do that once and
never again** — changing the public key invalidates every licence already in
circulation.

`keypair.json` is gitignored by exact path and by `**/keypair.json`. If it
ever leaks, every issued key must be reissued under a new public key.

## Tiers

| | Free | Pro / Team |
|---|---|---|
| Rounds per audit | 1 | unlimited |
| Feasibility rate | yes | yes |
| Named violations | yes | yes |
| Certificate | no | yes |
| JSON report | yes | yes |

The cap is enforced inside `runRoutes`, at the point of evaluation — not by
hiding rows in the interface. A limit that only exists in the presentation
layer is not a limit.

## What this is honestly worth

**It is a lock on an honest door.** The verifier is open source; anyone
determined can patch the check out in a minute. That is an accepted trade.

What it does do: stop casual sharing, make paying the path of least
resistance, and keep the product free of the accounts and servers that would
otherwise be needed. What actually governs commercial use is the AGPL — anyone
embedding this in a product they ship or host either open-sources that product
or buys a commercial licence.

Do not oversell this as DRM. It isn't, and claiming otherwise would be the
same class of unverified claim the engineering records exist to stop.

## Failure behaviour

Every rejection path degrades to the free tier with a reason, and
`verifyLicence` never throws. A malformed key, an expired key or a browser
that refuses `localStorage` all produce a working free product rather than an
error page. A broken licence must not take the tool down.
