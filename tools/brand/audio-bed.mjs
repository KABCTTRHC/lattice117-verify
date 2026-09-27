#!/usr/bin/env node
/**
 * Generates the audio bed for brand/demo.mp4 and muxes it in.
 *
 * # Procedural, not a library track
 *
 * Every sound here is synthesised by ffmpeg's own `lavfi` sources from numbers
 * in this file. Nothing is sampled, so there is no licence to honour, no file
 * to lose, and the bed is re-derivable from the repository like every other
 * artefact in it. It is also silent about anything it does not know: there is
 * no voiceover claiming results, because the results are on screen and a claim
 * in audio is a claim nobody can check against the frame.
 *
 * # The pad
 *
 * A fifth built on 117 Hz — the product's own number — with its octave and
 * fifth above: 117, 175.5 and 234 Hz. A perfect fifth is 3:2, so 117 x 1.5 =
 * 175.5, and 234 is the octave. Those three are consonant by construction
 * rather than by ear.
 *
 * Low-passed at 900 Hz so it sits under speech and under a laptop speaker's
 * presence peak, and held at -24 dBFS, which is quiet enough to talk over in a
 * meeting. A demo that forces someone to reach for the volume control is a
 * demo they stop watching.
 *
 * # The ticks
 *
 * One short filtered click per storyboard cut, at the timestamps the recorder
 * actually produces. They are cues, not percussion: -30 dBFS, 90 ms, and
 * band-passed around 2.1 kHz so they read as a mechanism engaging rather than
 * as a beat. If the storyboard's timings change, CUTS below is the one place
 * to change them, and the tool checks them against the video's real duration
 * rather than assuming.
 *
 *   node tools/brand/audio-bed.mjs                 mux into brand/demo.mp4
 *   node tools/brand/audio-bed.mjs --out x.mp4     write elsewhere
 *
 * Requires a full ffmpeg with AAC.
 */
import { spawn, execFileSync } from 'node:child_process';
import { renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };

const VIDEO = arg('in', join(ROOT, 'brand', 'demo.mp4'));
const OUT = arg('out', join(ROOT, 'brand', 'demo.mp4'));
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

/** 117 Hz, its fifth (3:2) and its octave. Consonant by construction. */
const ROOT_HZ = 117;
const FIFTH_HZ = ROOT_HZ * 1.5;          // 175.5
const OCTAVE_HZ = ROOT_HZ * 2;           // 234

/** Storyboard cuts, in seconds. One tick each. */
const CUTS = [
  [2.0,  'logo reveal'],
  [7.0,  'audit page'],
  [10.0, 'story mode begins'],
  [36.0, 'operations console'],
  [45.0, 'sheets sidebar'],
  [55.0, 'CLI reproduce'],
  [62.0, 'k8s referee'],
  [67.0, 'closing card'],
];

const FADE_IN = 1.6;
const FADE_OUT = 3.0;

/* TARGET LEVELS, and the measurements they are derived from.
 *
 * ffmpeg's `sine` source does not take an amplitude, and the three partials
 * are harmonically related (2:3:4 of 58.5 Hz) so they periodically align. The
 * summed pad therefore does NOT peak at unity, and assuming it did is how the
 * first cut of this bed came out 17 dB under its own documented level: a 1/3
 * pre-scale was applied to something already well below full scale, and then
 * -24 dB on top of that.
 *
 * So the gains below are measured rather than reasoned. Re-derive with:
 *
 *   ffmpeg -filter_complex "sine=frequency=117:duration=5[a];\
 *     sine=frequency=175.5:duration=5[b];sine=frequency=234:duration=5[c];\
 *     [a][b][c]amix=inputs=3:normalize=0[s]" -map '[s]' -f wav - \
 *     | ffmpeg -i - -af volumedetect -f null -
 *
 *   ffmpeg -filter_complex "sine=frequency=2106:duration=0.09,\
 *     bandpass=f=2100:width_type=h:w=700,afade=t=out:st=0.012:d=0.078[t]" \
 *     -map '[t]' -f wav - | ffmpeg -i - -af volumedetect -f null -
 */
const PAD_RAW_PEAK_DB = -9.3;    // measured, three summed sines
const TICK_RAW_PEAK_DB = -18.1;  // measured, one filtered click
const PAD_TARGET_DB = -24;       // quiet enough to talk over
const TICK_TARGET_DB = -30;      // a cue, not a beat

const PAD_GAIN_DB = (PAD_TARGET_DB - PAD_RAW_PEAK_DB).toFixed(1);
const TICK_GAIN_DB = (TICK_TARGET_DB - TICK_RAW_PEAK_DB).toFixed(1);

const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; p.stderr.on('data', (d) => { err += d; });
  p.on('close', (c) => (c === 0 ? res() : rej(new Error(err.slice(-2500)))));
});

if (!existsSync(VIDEO)) {
  throw new Error(`${VIDEO} does not exist — render it with record-demo.mjs first`);
}

/* The real duration, read from the file. Writing it down here would make the
   fade-out land somewhere else the moment the storyboard changed. */
const duration = Number(execFileSync(FFPROBE, [
  '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', VIDEO,
], { encoding: 'utf8' }).trim());
if (!Number.isFinite(duration) || duration <= 0) {
  throw new Error(`could not read a duration from ${VIDEO}`);
}

const late = CUTS.filter(([t]) => t >= duration);
if (late.length) {
  throw new Error(
    `these cues land past the end of a ${duration.toFixed(1)}s video: ` +
    `${late.map(([t, n]) => `${n} @ ${t}s`).join(', ')}. Update CUTS to match the ` +
    `storyboard rather than muxing cues nobody will hear.`);
}

process.stdout.write(`video is ${duration.toFixed(2)}s; ${CUTS.length} cues\n`);

/* ---- the filter graph ---------------------------------------------------
   Three sine partials summed, low-passed, quietened and faded. Then one
   click per cut: a short burst of the octave, band-passed and heavily
   attenuated, delayed to its timestamp. amix would divide the gain by the
   input count, so the sum uses `amerge`-free addition via amix with
   `normalize=0`, keeping each layer at the level it was authored at.
------------------------------------------------------------------------- */
const pad = [
  `sine=frequency=${ROOT_HZ}:duration=${duration}[p0]`,
  `sine=frequency=${FIFTH_HZ}:duration=${duration}[p1]`,
  `sine=frequency=${OCTAVE_HZ}:duration=${duration}[p2]`,
  `[p0][p1][p2]amix=inputs=3:normalize=0[padsum]`,
  // One gain stage, derived from the measured raw peak. Low-passed at 900 Hz
  // so it sits under speech and under a laptop speaker's presence peak.
  `[padsum]lowpass=f=900,volume=${PAD_GAIN_DB}dB,` +
  `afade=t=in:st=0:d=${FADE_IN},afade=t=out:st=${(duration - FADE_OUT).toFixed(2)}:d=${FADE_OUT}[pad]`,
].join(';');

const ticks = CUTS.map(([t], i) =>
  `sine=frequency=${OCTAVE_HZ * 9}:duration=0.09,` +
  `bandpass=f=2100:width_type=h:w=700,` +
  `afade=t=out:st=0.012:d=0.078,volume=${TICK_GAIN_DB}dB,` +
  `adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)}[t${i}]`).join(';');

const mixInputs = ['[pad]', ...CUTS.map((_, i) => `[t${i}]`)].join('');
const graph =
  `${pad};${ticks};${mixInputs}amix=inputs=${CUTS.length + 1}:normalize=0:duration=first,` +
  `apad=whole_dur=${duration},atrim=0:${duration},` +
  // A ceiling, so no accumulation of pad and cue can clip.
  `alimiter=limit=0.89,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a]`;

const tmp = join(ROOT, 'brand', '.demo-with-audio.mp4');
process.stdout.write('synthesising and muxing\n');
await run(FFMPEG, [
  '-y', '-i', VIDEO,
  '-filter_complex', graph,
  '-map', '0:v:0', '-map', '[a]',
  '-c:v', 'copy',                    // the picture is already mastered
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
  '-movflags', '+faststart',
  '-shortest', tmp,
]);
renameSync(tmp, OUT);

/* ---- verify, rather than announce --------------------------------------- */
const probe = execFileSync(FFPROBE, [
  '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,sample_rate,channels',
  '-of', 'default=nw=1', OUT,
], { encoding: 'utf8' });
process.stdout.write(probe);

/* The picture must come out of this UNCHANGED. Asserting it against the input
   rather than against a hard-coded 1920x1080 is both stricter and more honest:
   this tool's job is "do not damage the video", not "the video is 1080p", and
   a literal here would have to be edited every time the render geometry did. */
const inSpec = execFileSync(FFPROBE, [
  '-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', VIDEO,
], { encoding: 'utf8' }).trim();
const outSpec = execFileSync(FFPROBE, [
  '-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', OUT,
], { encoding: 'utf8' }).trim();
if (inSpec !== outSpec) {
  throw new Error(`the video stream changed: was "${inSpec}", now "${outSpec}"`);
}
const hasAudio = /codec_name=aac/.test(probe) && /sample_rate=48000/.test(probe) && /channels=2/.test(probe);
if (!hasAudio) throw new Error('the output has no 48 kHz stereo AAC audio stream');
process.stdout.write(`video stream unchanged: ${outSpec}\n`);

/* Silence is the failure this cannot see from the stream header alone, so
   measure the actual level rather than trusting that a filter ran. */
let vol = '';
try {
  execFileSync(FFMPEG, ['-v', 'info', '-i', OUT, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) { vol = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
if (!vol) {
  try {
    vol = execFileSync('sh', ['-c',
      `${FFMPEG} -v info -i "${OUT}" -af volumedetect -f null - 2>&1`], { encoding: 'utf8' });
  } catch { vol = ''; }
}
const mean = vol.match(/mean_volume:\s*(-?[\d.]+) dB/);
const peak = vol.match(/max_volume:\s*(-?[\d.]+) dB/);
if (mean && peak) {
  process.stdout.write(`mean_volume=${mean[1]} dB  max_volume=${peak[1]} dB\n`);
  const m = Number(mean[1]), pk = Number(peak[1]);
  if (m < -70) throw new Error('the audio track is effectively silent');
  if (pk > -0.5) throw new Error('the audio track is clipping');
  /* The bed is authored at -24 dBFS and must actually arrive near it. Without
     this the first cut's 17 dB gain-staging error would have shipped, because
     "there is an audio stream" was the only thing being checked. */
  if (pk < PAD_TARGET_DB - 8 || pk > PAD_TARGET_DB + 8) {
    throw new Error(
      `peak is ${pk} dB but the bed is authored for ${PAD_TARGET_DB} dBFS. ` +
      `Re-measure the raw levels (the commands are in this file) rather than ` +
      `nudging the constants until it sounds right.`);
  }
}
process.stdout.write(`wrote ${OUT} with video and audio\n`);
