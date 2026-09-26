/**
 * Licence verification — the public half. Safe to ship and to read.
 *
 * ECDSA P-256 / SHA-256 via WebCrypto, which every current browser and the
 * Excel task-pane webview support. The private key that signs licences is not
 * here and never will be.
 *
 * Deliberately honest about what this is: a lock on an honest door. The code
 * is open, so anyone determined can patch the check out. That is an accepted
 * trade, because the alternative is accounts, a server, and a database of
 * customer schedules — which would destroy the one property that makes this
 * product sellable, namely that nothing ever leaves the machine.
 *
 * Commercial use is actually governed by the AGPL and the commercial licence,
 * not by this file.
 */

const PUBLIC_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: '7neoiJMM1zUx50EfbTyMx212w9c-_Fw0_beHtFo-jGc',
  y: 'LRZJArtMaLgDAQGx__0lygl071cevKxOS_VDutvNXns',
};

const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIG = { name: 'ECDSA', hash: 'SHA-256' };

/** Free tier: enough to prove the tool works on your own data, not to run on it. */
export const FREE_TIER = Object.freeze({
  tier: 'free',
  maxRounds: 1,
  certificate: false,
  repair: false,
  matrixSolver: false,
  label: 'Free',
});

/**
 * What each paid tier grants.
 *
 * The split is deliberate: Standard removes the cap, Pro adds the
 * digest-sealed certificate. The certificate is the part with durable value —
 * a feasibility check is a moment, a reproducible record of it is something a
 * customer keeps in a compliance folder — so it is what the higher price buys.
 *
 * An unrecognised tier degrades to Standard rather than Pro. A key that was
 * mis-issued should under-deliver and get reported, not silently hand out the
 * paid feature.
 */
const TIERS = Object.freeze({
  standard: { maxRounds: Infinity, certificate: false, repair: false, matrixSolver: false, label: 'Standard' },
  pro:      { maxRounds: Infinity, certificate: true,  repair: false, matrixSolver: false, label: 'Pro' },
  team:     { maxRounds: Infinity, certificate: true,  repair: false, matrixSolver: false, label: 'Team' },

  /* Enterprise. The split follows what the data allows, not what sounds
     tidy: tier4 repairs a schedule using only what a single sheet already
     carries — departure times, slack, waits — while tier5 adds re-sequencing,
     which is impossible without a distance matrix the sheet does not have.
     See docs/TIER4-ENTERPRISE-SPEC.md §1 Gate A. Pricing the two apart is
     therefore an honest reflection of a real capability boundary, not a
     invented one. */
  tier4:    { maxRounds: Infinity, certificate: true, repair: true, matrixSolver: false, label: 'Enterprise Repair' },
  tier5:    { maxRounds: Infinity, certificate: true, repair: true, matrixSolver: true,  label: 'Enterprise Matrix' },
});

/* Aliases accepted on an issued key, so a licence minted as `enterprise_249`
   grants exactly what `tier4` grants. Kept explicit rather than pattern-matched:
   an unrecognised tier degrades to Standard by design, and a silent degrade is
   the correct failure for a typo but the wrong one for a name we chose. */
const TIER_ALIASES = Object.freeze({
  enterprise_249: 'tier4',
  enterprise_499: 'tier5',
});

/** Canonical tier name for an issued string, or null if it is not one of ours. */
export function canonicalTier(name) {
  const t = String(name ?? '').trim();
  if (Object.prototype.hasOwnProperty.call(TIERS, t)) return t;
  if (Object.prototype.hasOwnProperty.call(TIER_ALIASES, t)) return TIER_ALIASES[t];
  return null;
}

/** Every tier name that may legitimately be issued, aliases included. */
export const ISSUABLE_TIERS = Object.freeze(
  [...Object.keys(TIERS), ...Object.keys(TIER_ALIASES)].filter((t) => t !== 'free'),
);

const unb64u = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

let _key = null;
async function publicKey() {
  if (!_key) _key = await crypto.subtle.importKey('jwk', PUBLIC_JWK, ALG, false, ['verify']);
  return _key;
}

/**
 * Verifies a licence key and returns the entitlement it grants.
 * Any failure — malformed, bad signature, expired — degrades to FREE_TIER
 * with a reason. It never throws, because a broken licence must not take the
 * product down; it must quietly become the free product.
 *
 * @param {string} licence
 * @returns {Promise<{tier:string,maxRounds:number,certificate:boolean,label:string,email?:string,expires?:Date,reason?:string}>}
 */
export async function verifyLicence(licence) {
  if (!licence || typeof licence !== 'string' || !licence.includes('.')) {
    return { ...FREE_TIER, reason: 'no licence key' };
  }
  try {
    const [body, sig] = licence.trim().split('.');
    const ok = await crypto.subtle.verify(
      SIG, await publicKey(), unb64u(sig), new TextEncoder().encode(body)
    );
    if (!ok) return { ...FREE_TIER, reason: 'signature does not verify' };

    const p = JSON.parse(new TextDecoder().decode(unb64u(body)));
    if (p.exp * 1000 < Date.now()) {
      return { ...FREE_TIER, reason: `expired ${new Date(p.exp * 1000).toISOString().slice(0, 10)}` };
    }
    const canonical = canonicalTier(p.tier);
    const grant = canonical ? TIERS[canonical] : TIERS.standard;
    return {
      tier: p.tier,
      maxRounds: grant.maxRounds,
      certificate: grant.certificate,
      label: grant.label,
      email: p.sub,
      expires: new Date(p.exp * 1000),
    };
  } catch (e) {
    return { ...FREE_TIER, reason: 'licence key is malformed' };
  }
}

/**
 * Reads a saved licence from localStorage and verifies it.
 * Storage may throw in a private window or with site data blocked, so every
 * access is guarded — a browser that refuses storage still gets the free tier
 * rather than an error page.
 */
export async function currentEntitlement(storageKey = 'lattice117.licence') {
  let saved = null;
  try { saved = localStorage.getItem(storageKey); } catch { /* blocked */ }
  return verifyLicence(saved);
}

export function saveLicence(licence, storageKey = 'lattice117.licence') {
  try { localStorage.setItem(storageKey, licence.trim()); return true; } catch { return false; }
}

export function clearLicence(storageKey = 'lattice117.licence') {
  try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
}
