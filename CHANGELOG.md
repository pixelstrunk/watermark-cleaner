# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-08-13

### Changed

- Image metadata stripping is now lossless. JPEG, PNG and WebP files are cleaned by removing metadata segments at the container level. Pixels are never re-encoded, so there is no quality loss. The Pillow dependency and the `[images]` extra are gone.
- GIF and TIFF files are never modified. The tool reports that lossless stripping is not supported for these formats instead of silently degrading them.
- The zero width non-joiner (U+200C) is only removed when it is not adjacent to a script that requires it (Arabic, Persian, Syriac, Indic scripts, Sinhala, Tibetan, Myanmar, Khmer, Mongolian). Persian and Indic text is no longer corrupted.
- Bidi marks and bidi controls (LRM, RLM, ALM, embeddings, isolates) are kept with a warning when the document contains right-to-left text. In pure left-to-right documents they are removed as before (Trojan Source defense).
- Deleting a filler phrase now repairs the sentence: leftover spaces are removed and the first letter after the deletion is capitalized when the phrase opened a sentence.
- "let's explore", "let's unpack" and "let's take a closer look" are no longer auto-deleted, because they usually carry an object and deleting them breaks the sentence. They are still flagged as blocking phrases.
- The dash replacement policy can now be overridden per project via the `dash_policy` key in `wmc.config.json`.
- The Python package is now built from the repository root, which makes the repo usable directly as a pre-commit hook repository.

- Typography and voice rules no longer touch fenced code blocks, inline code or YAML frontmatter. Invisible characters are still removed inside code (Trojan Source defense). Disable via `protect_code: false`.
- Deleting a filler phrase no longer triggers a whole-document reformat. Cleanup happens only around the deletion point, so indentation, table alignment and markdown line breaks survive.
- ICC color profiles (JPEG APP2, PNG iCCP, WebP ICCP) are kept by default because stripping them visibly shifts colors. Strip them with `strip_icc: true` or `--aggressive`.
- The non breaking space number guard now uses ascii digits in both engines; Python previously accepted all unicode digits while Node did not.
- The Node directory walker no longer follows directory symlinks, which prevents infinite loops, and matches the Python behavior for symlinked files.
- All phrase and shape regexes are compiled once and cached instead of being recompiled per file.
- `wmc rewrite` auto-detects the document language via DeepL when `--source-lang` is not given, instead of assuming German, and reports rate limit and quota errors in plain language.

### Added

- The Node CLI accepts `--flag=value` syntax in addition to `--flag value`, matching the Python CLI.
- WebP cleaning also strips C2PA content credential chunks (`JUMB`, `C2PA`, `c2pa`).
- New AI phrases in the rulebook: "a myriad of", "a plethora of", "beacon of", "fostering a culture of", "rich tapestry", "at the forefront of" and "demystify" block; "poised to" warns.
- Safe writes: cleaned files are written atomically (temp file plus rename), writes through symlinks are refused with a warning, and files larger than `max_file_bytes` (default 256 MiB, env `WMC_MAX_FILE_BYTES`) are skipped instead of loaded into memory.
- Supply chain hardening: all GitHub Actions are pinned to commit SHAs, workflows run with least-privilege permissions, plus CodeQL analysis, Dependabot updates and a pip-audit job.
- Agent skill packaging: `skills/wmc-cleaner/SKILL.md` lets coding agents drive the CLI with an inspect-first workflow.
- `--strict` flag: `wmc fix --strict` exits non-zero when blocking findings remain that need a human rewrite.
- `custom_banned_phrases` and `ignore_phrases` config keys for project-specific rule tuning.
- `.pre-commit-hooks.yaml` with `wmc-fix` and `wmc-check` hooks for the pre-commit framework.
- `--version` flag in both CLIs.
- Cross-implementation parity test that runs the same fixtures through the Python and the Node CLI and asserts identical output.
- CI test matrix across Python 3.9 to 3.13 and Node 18 to 22, a rules-sync check and a package install smoke test.
- Release workflow that publishes to PyPI and npm via trusted publishing.
- Clean error reports for paths that do not exist and for non-UTF-8 files in the Node CLI, matching the Python behavior.
- `.tif`/`.tiff` handling in the Node CLI, matching the Python defaults.

## [0.1.0] - 2026-08-12

### Added

- Initial release: Python and Node CLI with shared rules for characters, homoglyphs, typography and voice, SVG and raster metadata handling, DeepL rewrite, pre-commit and deploy-gate integrations.
