#!/usr/bin/env node
/**
 * Renders demo/splash.html to a video file, frame-exactly.
 *
 * WHY THIS EXISTS. The splash itself is CSS over two stills, because the
 * product's offline claim cannot survive a loading screen that fetches an MP4.
 * But a deck, a landing page and a social post all want a video, and hand-
 * recording a screen capture gives you something nobody can reproduce and
 * everybody has to re-do when the tagline changes. This renders the real page.
 *
 * DETERMINISM. Frames are not sampled against the wall clock. Every animation
 * is paused and its `currentTime` is set explicitly, so frame N is a pure
 * function of N — the same machine, a slower machine and a loaded CI runner all
 * produce identical frames. That is the same discipline as the rest of this
 * repository, applied to a video.
 *
 * Two things that will silently produce a broken render if you skip them, both
 * learned the hard way:
 *   * `decoding="async"` means the `load` event does NOT mean decoded. Without
 *     an explicit `img.decode()` the early frames come out with no artwork.
 *   * Infinite animations must be paused too, or they keep running between the
 *     seek and the screenshot and the sweep smears.
 *
 *   node tools/brand/record-splash.mjs                 1920x1080, 30fps
 *   node tools/brand/record-splash.mjs --width 1080 --height 1080   square
 *   node tools/brand/record-splash.mjs --fps 60 --hold 1.5
 *
 * Requires: playwright (dev-only, not a product dependency) and ffmpeg.
 * Outputs brand/splash.mp4 and brand/splash.webm.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const WIDTH  = Number(arg('width', 1920));
const HEIGHT = Number(arg('height', 1080));
const FPS    = Number(arg('fps', 30));
/** Extra seconds on the final frame, so the mark does not vanish on loop. */
const HOLD   = Number(arg('hold', 1.2));
const PORT   = Number(arg('port', 8911));

const CHROME = process.env.CHROME_PATH
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
/* A FULL ffmpeg, not Playwright's bundled one. That build is configured
   `--disable-everything` with only VP8 and the webm muxer, so it cannot write
   H.264 and refuses `-preset` outright — and an MP4 is the format a deck, a
   LinkedIn post and an email attachment actually accept. `apt-get install
   ffmpeg` is enough; the path can be overridden for a machine where it lives
   elsewhere. */
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';

const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => (code === 0 ? res() : rej(new Error(err.slice(-2000)))));
});

/* A static file server rather than file:// — the page uses `mask-image` with a
   URL, and file:// origins treat that as cross-origin in some builds. */
async function serve(dir, port) {
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const TYPES = { '.html': 'text/html', '.webp': 'image/webp', '.png': 'image/png',
                  '.js': 'text/javascript', '.mjs': 'text/javascript' };
  const server = createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const body = await readFile(join(dir, rel));
      const ext = rel.slice(rel.lastIndexOf('.'));
      res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return server;
}

const server = await serve(join(ROOT, 'demo'), PORT);
const frames = mkdtempSync(join(tmpdir(), 'l117-splash-'));

try {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--force-color-profile=srgb', '--disable-lcd-text'],
  });
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    // The splash's reduced-motion branch is the FINAL FRAME with no sequence.
    // Recording under it would produce a still, so force motion on.
    reducedMotion: 'no-preference',
  });

  await page.goto(`http://127.0.0.1:${PORT}/splash.html`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await page.evaluate(() => document.fonts.ready);

  const totalMs = await page.evaluate(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--t-total').trim();
    const n = parseFloat(raw);
    return raw.endsWith('ms') ? n : n * 1000;
  });

  const count = Math.round(((totalMs / 1000) + HOLD) * FPS);
  process.stdout.write(`rendering ${count} frames at ${WIDTH}x${HEIGHT}, ${FPS}fps\n`);

  for (let i = 0; i < count; i++) {
    const t = (i / FPS) * 1000;
    await page.evaluate((ms) => {
      // Every animation, infinite ones included. An unpaused infinite sweep
      // keeps advancing between seek and shot, which smears the highlight.
      document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ms; });
    }, t);
    // NO `animations: 'disabled'` here. That option does not freeze an
    // animation where it is — it FAST-FORWARDS every finite animation to its
    // end state before shooting. With it set, all 228 frames came out as the
    // final frame and the BSG scene never appeared in the video at all. The
    // explicit pause-and-seek above is the freeze; this just shoots it.
    await page.screenshot({ path: join(frames, `f${String(i).padStart(5, '0')}.png`) });
  }
  await browser.close();

  const out = join(ROOT, 'brand');
  if (!existsSync(out)) mkdirSync(out, { recursive: true });

  const input = ['-y', '-framerate', String(FPS), '-i', join(frames, 'f%05d.png')];
  // yuv420p and even dimensions, or Safari and PowerPoint refuse the file.
  await run(FFMPEG, [...input, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
                     '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                     join(out, 'splash.mp4')]);
  await run(FFMPEG, [...input, '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0',
                     '-pix_fmt', 'yuv420p', '-row-mt', '1',
                     join(out, 'splash.webm')]);
  process.stdout.write(`wrote brand/splash.mp4 and brand/splash.webm\n`);
} finally {
  rmSync(frames, { recursive: true, force: true });
  server.close();
}
