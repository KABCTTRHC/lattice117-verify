/**
 * Render docs/WHITEPAPER-determinism.md to PDF.
 *
 * This exists because the Word route kept damaging the document: the appendices
 * were dropped at the page break, the shell block's trailing comments wrapped
 * and interleaved with the commands, the determinism matrix lost a cell, and a
 * font substitution turned "lattice117" into "latticell7" in a URL. None of
 * those were defects in the source. Rendering straight from the Markdown means
 * the PDF cannot disagree with the repository.
 *
 *   node tools/paper/render.mjs
 */
import { marked } from 'marked';
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const SRC = join(REPO, 'docs', 'WHITEPAPER-determinism.md');
const OUT = join(REPO, 'docs', 'WHITEPAPER-determinism.pdf');
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const md = readFileSync(SRC, 'utf8');
const body = marked.parse(md, { gfm: true, breaks: false });

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Reproducible Verdicts</title>
<style>
  @page { size: A4; margin: 20mm 18mm 18mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font: 10.5pt/1.55 "Georgia","Times New Roman",serif;
    color:#15191f; margin:0; hyphens:none;
  }
  h1,h2,h3 { font-family:"Helvetica Neue",Helvetica,Arial,sans-serif; color:#0b0e13;
             line-height:1.22; break-after:avoid; }
  h1 { font-size:21pt; letter-spacing:-.015em; margin:0 0 .5em; }
  h2 { font-size:14pt; margin:1.9em 0 .55em; padding-bottom:.28em;
       border-bottom:1.2px solid #d5dae1; break-before:auto; }
  h3 { font-size:11.6pt; margin:1.5em 0 .45em; color:#1d2530; }
  p, li { orphans:3; widows:3; }
  p { margin:0 0 .72em; }
  strong { color:#0b0e13; }

  /* Tables must never lose a cell to a page break. */
  table { width:100%; border-collapse:collapse; margin:1em 0 1.2em;
          font-family:"Helvetica Neue",Helvetica,Arial,sans-serif; font-size:8.6pt;
          break-inside:avoid; }
  thead { display:table-header-group; }
  tr { break-inside:avoid; }
  th, td { border:1px solid #ccd3db; padding:5px 7px; text-align:left;
           vertical-align:top; }
  th { background:#eef2f6; font-weight:700; white-space:nowrap; }
  /* The ISA column: keep AArch64 on one line. */
  td:nth-child(2) { white-space:nowrap; }
  td code, th code { font-size:8.2pt; white-space:nowrap; }

  /* Code blocks: never reflow, never break mid-block. */
  pre { background:#f5f7fa; border:1px solid #d9e0e8; border-radius:4px;
        padding:9px 11px; overflow:visible; white-space:pre-wrap;
        word-break:break-word; break-inside:avoid; margin:.9em 0 1.1em; }
  pre code { font:8.1pt/1.45 "SFMono-Regular",Consolas,"Liberation Mono",monospace;
             color:#1b2230; background:none; padding:0; white-space:pre-wrap; }
  :not(pre) > code { font:9pt/1 "SFMono-Regular",Consolas,"Liberation Mono",monospace;
                     background:#eef1f5; border:1px solid #dfe5ec; border-radius:3px;
                     padding:.08em .32em; }

  blockquote { margin:1em 0; padding:.55em .9em; border-left:3px solid #10817a;
               background:#f2f8f7; break-inside:avoid; }
  blockquote p { margin:0 0 .4em; } blockquote p:last-child { margin:0; }
  hr { border:0; border-top:1px solid #d5dae1; margin:1.6em 0; }
  a { color:#0d5f8a; text-decoration:none; word-break:break-all; }

  /* The appendix evidence blocks are the record; keep each one whole. */
  h3 + pre { break-inside:avoid; }
</style></head><body>${body}</body></html>`;

const tmp = join(HERE, '.paper.html');
writeFileSync(tmp, html);

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage();
await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
await page.pdf({
  path: OUT, format: 'A4', printBackground: true,
  margin: { top:'20mm', bottom:'18mm', left:'18mm', right:'18mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font:8pt Helvetica,Arial,sans-serif;color:#7b858f;' +
    'padding:0 18mm;display:flex;justify-content:space-between;">' +
    '<span>Lattice117 · Brierley Sovereign Group Ltd</span>' +
    '<span class="pageNumber"></span></div>',
});
await browser.close();

const stats = {
  appendices: (md.match(/^## Appendix/gm) || []).length,
  evidenceBlocks: (md.match(/OVERALL DETERMINISTIC/g) || []).length,
  tables: (md.match(/^\|---/gm) || []).length,
};
console.log('Wrote', OUT);
console.log(`  appendices ${stats.appendices}, evidence blocks ${stats.evidenceBlocks}, tables ${stats.tables}`);
