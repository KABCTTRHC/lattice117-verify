# Releases on npm

Each row is checked against the registry, not taken from the publishing
machine's output alone.

| Version | Published | From | Registry record | Checked after publishing |
|---|---|---|---|---|
| 0.3.0 | 19 Nov 2026, as `latest` | The owner's Windows PC (Node v25.2.1, npm 11), from a fresh clone at `80a64e7` | 15 files, 45.3 kB packed, 124.2 kB unpacked; shasum `acefb5ff9a0441f1286c3369d0d0326b5cc1e548`; integrity `sha512-wOJOkfzv9OoPCk4ElWfleQ/2EgqlED5VAPWngnoMA+gwKfEBvvDd2dnNNnr4VPWQeGe5ECVnQ3dUBZg44aQ0qA==` | On Linux (Node v22.22.0), installed from the registry: `npx lattice117-verify@0.3.0 reproduce` gives 3 of 3 digests; `lattice117-mcp` answers `initialize` and lists its five tools. The tarball's 15 files are byte-identical to `npm/` at `80a64e7`, which is tagged `v0.3.0` |
| 0.2.3 | 12 Oct 2026, as `latest`; 0.2.2 deprecated | — | — | `sovereign_api` `docs/engineering-record/OPEN-ISSUES.md` U10 |

## Notes from publishing 0.3.0

* The first attempt stopped in `prepublishOnly`: the reproduce command passed a
  Windows path to `import()` (`ERR_UNSUPPORTED_ESM_URL_SCHEME`). 0.2.3 had
  carried the fix, but it had never reached the repository. Restored in
  `80a64e7`, with a test that reads the source, since Linux cannot hit the
  failure. Nothing was published by the failed attempt.
* npm 11 warned that `"bin[...]" script name bin/....mjs was invalid and
  removed` and asked for `npm pkg fix`. The bins were not lost: npm rewrote
  `./bin/x.mjs` to `bin/x.mjs`, and the registry record has both commands.
  `npm/package.json` now uses that form, and `prepublish-check.mjs` refuses the
  `./` form, so the warning does not come back.
