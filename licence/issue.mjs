#!/usr/bin/env node
/**
 * Licence issuing tool — KEEP THIS AND THE PRIVATE KEY OFF ANY PUBLIC HOST.
 *
 * ECDSA P-256 over SHA-256. Chosen over Ed25519 because WebCrypto support for
 * P-256 is universal across browsers and the Excel task-pane webview, whereas
 * Ed25519 is still uneven. The verifier ships with the PUBLIC key only.
 *
 *   node issue.mjs keygen                          -> writes keypair.json
 *   node issue.mjs issue <email> <tier> <months>    -> prints a licence key
 *   node issue.mjs verify <key>                     -> checks one locally
 *
 * A client-side licence is a lock on an honest door: anyone determined can
 * patch the check out of open-source JavaScript. That is accepted on purpose.
 * It stops casual sharing, it keeps the product free of accounts and servers,
 * and the AGPL is what actually governs commercial use.
 */
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIG = { name: 'ECDSA', hash: 'SHA-256' };
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));

async function keygen() {
  const kp = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  writeFileSync('keypair.json', JSON.stringify({ publicJwk: pub, privateJwk: priv }, null, 2));
  console.log('Wrote keypair.json — NEVER commit this file.\n');
  console.log('Paste this public key into licence.js:\n');
  console.log(JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, null, 2));
}

async function issue(email, tier, months) {
  const { privateJwk } = JSON.parse(readFileSync('keypair.json', 'utf8'));
  const key = await crypto.subtle.importKey('jwk', privateJwk, ALG, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: email,
    tier,
    iat: now,
    exp: now + Math.round(Number(months) * 30.44 * 86400),
    v: 1,
  };
  const body = b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign(SIG, key, new TextEncoder().encode(body));
  console.log(`${body}.${b64u(sig)}`);
}

async function verify(licence) {
  const { publicJwk } = JSON.parse(readFileSync('keypair.json', 'utf8'));
  const key = await crypto.subtle.importKey('jwk', publicJwk, ALG, false, ['verify']);
  const [body, sig] = licence.split('.');
  const ok = await crypto.subtle.verify(SIG, key, unb64u(sig), new TextEncoder().encode(body));
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  const expired = payload.exp * 1000 < Date.now();
  console.log({ signatureValid: ok, expired, payload });
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'keygen') await keygen();
else if (cmd === 'issue') await issue(args[0], args[1] ?? 'pro', args[2] ?? 12);
else if (cmd === 'verify') await verify(args[0]);
else {
  console.error('usage: issue.mjs keygen | issue <email> <tier> <months> | verify <key>');
  process.exit(2);
}
