#!/usr/bin/env node
/**
 * Renders the full product walkthrough to brand/demo.mp4.
 *
 * # Why this is a storyboard rather than a screen recording
 *
 * A screen capture of someone clicking through the product is unreproducible
 * by construction: it embeds one machine's frame timing, one person's mouse,
 * and whatever the page happened to be doing that afternoon. Change the
 * tagline and you re-record the lot.
 *
 * This walks a declared list of STEPS. Each step performs an action, waits on
 * a condition that is a property of the DATA rather than of the clock, then
 * emits a fixed number of identical frames. Scrolls are driven by setting
 * `scrollTop` per frame from an easing function, not by asking the browser to
 * animate. CSS transitions are disabled throughout. The result is a video that
 * is a pure function of the repository.
 *
 * Act 1 is the exception and it is exact for a different reason: the splash IS
 * an animation, so its frames are produced by pausing every animation and
 * setting `currentTime` explicitly, as in record-splash.mjs.
 *
 * # Nothing on screen is typed into this file
 *
 * Act 3 shows a terminal. Its contents are the real stdout of the real
 * commands, captured during the render. A card with the output pasted in would
 * go stale the first time a digest moved and nobody would notice until a
 * customer ran the command themselves. If the CLI exits non-zero, this tool
 * fails rather than filming a failure as though it passed.
 *
 *   node tools/brand/record-demo.mjs
 *   node tools/brand/record-demo.mjs --fps 30 --scale 1
 *
 * Requires: playwright and a full ffmpeg (Playwright's bundled build is
 * --disable-everything and cannot write H.264).
 */
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };

const W = Number(arg('width', 1920));
const H = Number(arg('height', 1080));
const FPS = Number(arg('fps', 30));
const PORT = Number(arg('port', 8912));
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';

const sec = (s) => Math.round(s * FPS);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* ---------------------------------------------------------------------------
   Real command output, captured now.
--------------------------------------------------------------------------- */
function capture(label, cmd, args, cwd) {
  process.stdout.write(`  capturing: ${label}\n`);
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`${label} failed (exit ${e.status}) — refusing to film a failing command as ` +
                    `though it passed.\n${e.stdout ?? ''}${e.stderr ?? ''}`);
  }
}

/** Colours the captured text. Only ever highlights, never rewrites. */
function paint(text) {
  return esc(text)
    .replace(/^(\s*)(MATCH|PASS|ok)\b/gm, '$1<span class="ok">$2</span>')
    .replace(/^(\s*)(MISMATCH|FAIL|FAILED)\b/gm, '$1<span class="bad">$2</span>')
    .replace(/\b([0-9a-f]{64})\b/g, '<span class="hi">$1</span>')
    .replace(/^(test result:.*)$/gm, '<span class="ok">$1</span>')
    .replace(/^(\$ .*)$/gm, '<span class="cmd">$1</span>');
}

/* ---------------------------------------------------------------------------
   Static file server for demo/ and tools/brand/.
--------------------------------------------------------------------------- */
async function serve(port) {
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const TYPES = { '.html': 'text/html', '.webp': 'image/webp', '.png': 'image/png',
                  '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
                  '.csv': 'text/csv', '.txt': 'text/plain', '.json': 'application/json' };
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    /* Three roots: the product pages, the video cards, and the Sheets bundle
       (which lives outside demo/ because Apps Script serves it, not a web
       server). Routed by prefix so no act has to reach up out of a directory. */
    const base = url.startsWith('/cards/')  ? join(ROOT, 'tools', 'brand')
               : url.startsWith('/sheets/') ? join(ROOT, 'sheets-addon')
               : join(ROOT, 'demo');
    const rel = url.replace(/^\/(cards|sheets)\//, '/').replace(/^\/+/, '') || 'index.html';
    try {
      const body = await readFile(join(base, rel));
      res.writeHead(200, { 'content-type': TYPES[rel.slice(rel.lastIndexOf('.'))] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return server;
}

const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; p.stderr.on('data', (d) => { err += d; });
  p.on('close', (c) => (c === 0 ? res() : rej(new Error(err.slice(-1600)))));
});

/* ========================================================================= */
process.stdout.write('capturing real command output\n');
const reproduceOut = capture('npx lattice117-verify reproduce',
  process.execPath, ['bin/lattice117-verify.mjs', 'reproduce'], join(ROOT, 'npm'));

const SOVEREIGN = process.env.SOVEREIGN_API ?? join(dirname(ROOT), 'sovereign_api');
let refereeOut = null;
if (existsSync(join(SOVEREIGN, 'Cargo.toml'))) {
  const raw = capture('cargo test ffi::k8s_bridge', 'cargo',
    ['test', '--lib', 'ffi::k8s_bridge', '--', '--nocapture'], SOVEREIGN);
  const keep = raw.split('\n').filter((l) =>
    /^test ffi::k8s_bridge::tests::(a_bin_that|no_node_is|the_referee_catches_a_cpu|a_pod_that_fits|splitting_separates|the_cheapest|making_an)/.test(l)
    || /^test result:/.test(l));
  refereeOut = keep.join('\n');
} else {
  process.stdout.write('  (sovereign_api not present — Act 3b will be skipped)\n');
}

const server = await serve(PORT);
const frames = mkdtempSync(join(tmpdir(), 'l117-demo-'));
let n = 0;

try {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--force-color-profile=srgb'] });
  const page = await browser.newPage({
    viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: 'no-preference',
  });
  const shot = async () => {
    await page.screenshot({ path: join(frames, `f${String(n++).padStart(5, '0')}.png`) });
  };
  const hold = async (seconds) => { const k = sec(seconds); for (let i = 0; i < k; i++) await shot(); };

  const settle = async () => {
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
    await page.evaluate(() => document.fonts.ready);
  };
  /* Transitions off everywhere but the splash: an in-flight transition makes a
     frame a function of when it was taken. */
  const freeze = () => page.addStyleTag({ content:
    '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' });

  /** Eased scroll, driven frame by frame rather than animated by the browser. */
  const scrollTo = async (sel, from, to, seconds) => {
    const k = sec(seconds);
    for (let i = 0; i < k; i++) {
      const t = k === 1 ? 1 : i / (k - 1);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // easeInOutQuad
      await page.evaluate(([s, y]) => {
        (s ? document.querySelector(s) : document.scrollingElement).scrollTop = y;
      }, [sel, Math.round(from + (to - from) * e)]);
      await shot();
    }
  };

  /* ---------------- ACT 1 — the splash, frame-exact ------------------ */
  process.stdout.write('act 1 — splash\n');
  await page.goto(`http://127.0.0.1:${PORT}/splash.html`, { waitUntil: 'load' });
  await settle();
  const splashMs = await page.evaluate(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--t-total').trim();
    return raw.endsWith('ms') ? parseFloat(raw) : parseFloat(raw) * 1000;
  });
  const splashFrames = sec(splashMs / 1000 + 0.9);
  for (let i = 0; i < splashFrames; i++) {
    await page.evaluate((ms) => {
      document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ms; });
    }, (i / FPS) * 1000);
    await shot();
  }

  /* ---------------- ACT 2 — the live auditor ------------------------- */
  process.stdout.write('act 2 — audit.html story mode\n');
  await page.goto(`http://127.0.0.1:${PORT}/audit.html`, { waitUntil: 'load' });
  await page.waitForFunction(() =>
    /bytes/.test(document.getElementById('engineBadge')?.textContent ?? ''), null, { timeout: 20000 });
  await settle(); await freeze();
  await hold(2.6);                                  // header, badges, air-gap banner

  await page.click('#storyRun');
  /* Wait on the DATA, not the clock: every tier has landed when the last one
     has rendered a result. */
  for (let i = 0; i < 5; i++) {
    await page.waitForFunction((k) => {
      const li = document.querySelectorAll('#storyLine li')[k];
      return li && /£|holds|achievable|rounds|Travel/.test(li.innerText) && li.innerText.length > 260;
    }, i, { timeout: 60000 });
    const box = await page.evaluate((k) => {
      const li = document.querySelectorAll('#storyLine li')[k];
      const r = li.getBoundingClientRect();
      return { y: r.top + document.scrollingElement.scrollTop - 120 };
    }, i);
    const cur = await page.evaluate(() => document.scrollingElement.scrollTop);
    await scrollTo(null, cur, Math.max(0, box.y), 0.85);
    await hold(i === 0 ? 3.0 : 3.4);                // long enough to read a tier
  }

  const maxY = await page.evaluate(() =>
    document.scrollingElement.scrollHeight - innerHeight);
  const atNow = await page.evaluate(() => document.scrollingElement.scrollTop);
  await scrollTo(null, atNow, maxY, 2.6);           // plans cards + licence box
  await hold(2.4);

  /* ---------------- ACT 2b — the dashboard --------------------------- */
  process.stdout.write('act 2b — dashboard\n');
  await page.goto(`http://127.0.0.1:${PORT}/dashboard.html`, { waitUntil: 'load' });
  await page.waitForFunction(() =>
    /bytes/.test(document.getElementById('engineChip')?.textContent ?? ''), null, { timeout: 20000 });
  await settle(); await freeze();
  await hold(1.4);
  await page.click('#bNott');
  await page.waitForFunction(() => !document.getElementById('bVerify').disabled);
  await page.click('#bVerify');
  await page.waitForFunction(() => !document.getElementById('bar').hidden);
  await hold(2.2);
  await page.click('#bSeq');
  await page.waitForFunction(() => !document.getElementById('seqPanel').hidden);
  await hold(2.6);
  await page.click('#bDet');
  /* `innerText` is the RENDERED text, so CSS `text-transform: uppercase` on the
     stat's caption turns this into "DISTINCT DIGEST IN 12 RUNS" and a
     lowercase pattern never matches. `textContent` would have been immune;
     the case-insensitive flag is the smaller change and says why it is here. */
  await page.waitForFunction(() =>
    /distinct digest/i.test(document.getElementById('detBody').textContent));
  await hold(3.0);

  /* ---------------- ACT 3 — the spreadsheet surface ------------------ */
  /* The Sheets sidebar is a 300px column, so it is framed inside the 1920px
     canvas rather than stretched across it — a sidebar shown full-bleed is a
     sidebar nobody will recognise when they open it in Sheets. */
  process.stdout.write('act 3 — sheets sidebar\n');
  await page.goto(`http://127.0.0.1:${PORT}/cards/frame.html?src=/sheets/Sidebar.html`,
                  { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await settle(); await freeze();
  await hold(2.4);
  /* The onboarding disclosure, opened. Its example-loader buttons need the
     Apps Script host to write into a sheet, so they are SHOWN and not clicked:
     filming a result the standalone page cannot actually produce would be the
     one thing this whole product argues against. */
  await page.evaluate(() => {
    const d = document.getElementById('stage').contentDocument;
    d.querySelectorAll('details').forEach((x) => { x.open = true; });
  });
  await hold(2.8);
  /* Scroll the sidebar itself, frame by frame, to the tier controls and the
     plans drawer below them. */
  const inner = await page.evaluate(() => {
    const d = document.getElementById('stage').contentDocument.scrollingElement;
    return d.scrollHeight - d.clientHeight;
  });
  {
    const k = sec(3.4);
    for (let i = 0; i < k; i++) {
      const t = k === 1 ? 1 : i / (k - 1);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      await page.evaluate(([y]) => {
        document.getElementById('stage').contentDocument.scrollingElement.scrollTop = y;
      }, [Math.round(inner * e)]);
      await shot();
    }
  }
  await hold(1.8);

  /* ---------------- ACT 3b/3c — the proofs --------------------------- */
  process.stdout.write('act 3b — reproduction CLI\n');
  await page.goto(`http://127.0.0.1:${PORT}/cards/cards.html`, { waitUntil: 'load' });
  await settle(); await freeze();
  await page.evaluate(([t, p, h]) => window.showTerminal(t, p, h),
    ['Independent re-derivation', '~/lattice117-verify  $  npx lattice117-verify reproduce',
     paint(reproduceOut)]);
  await hold(6.5);

  if (refereeOut) {
    process.stdout.write('act 3c — referee proof\n');
    await page.evaluate(([t, p, h]) => window.showTerminal(t, p, h),
      ['The referee refuses its own solver',
       '~/sovereign_api  $  cargo test --lib ffi::k8s_bridge',
       paint(refereeOut)]);
    await hold(5.5);
  }

  /* ---------------- ACT 4 — closing ---------------------------------- */
  process.stdout.write('act 4 — closing card\n');
  await page.evaluate(() => window.showClosing());
  await settle();
  await hold(4.2);

  await browser.close();

  /* ---------------- encode ------------------------------------------- */
  process.stdout.write(`encoding ${n} frames (${(n / FPS).toFixed(1)}s)\n`);
  const out = join(ROOT, 'brand');
  if (!existsSync(out)) mkdirSync(out, { recursive: true });
  const input = ['-y', '-framerate', String(FPS), '-i', join(frames, 'f%05d.png')];
  await run(FFMPEG, [...input, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
                     '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'demo.mp4')]);
  process.stdout.write(`wrote brand/demo.mp4 — ${(n / FPS).toFixed(1)}s\n`);
} finally {
  rmSync(frames, { recursive: true, force: true });
  server.close();
}
