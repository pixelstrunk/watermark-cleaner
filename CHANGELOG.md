# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- DOCX and ODT metadata stripping (`docProps/core.xml` and `docProps/app.xml` for DOCX, `meta.xml` for ODT): author, last-editor and creating-application fields are removed, container-level and lossless, with every other part of the archive copied through byte-for-byte. PDF is not supported yet.
- Config files are now validated on load: wrong types (for example `"voice": 0`) fail with a clear message and exit code 2 instead of behaving differently per CLI.
- Per-shape severity in the phrase rulebook. `not-only-but-also` and `less-x-more-y` now warn instead of block, because they flag ordinary English too often.
- Parity CI now also compares the `--json` reports of both CLIs, not just file bytes and exit codes, and includes a CRLF fixture.

### Fixed

- Files with Windows (CRLF) line endings: front matter and code protection now works on them, and neither CLI rewrites line endings anymore. Previously the Node CLI could edit YAML front matter in CRLF files and the Python CLI silently converted every CRLF file to LF.
- The `exclude` list no longer matches directories above the path you asked to scan. `check build/docs` previously scanned zero files and reported success in the Python CLI.
- The Python CLI preserves file permissions when rewriting; previously rewritten files ended up owner-only (0600).
- Password-protected DOCX/ODT no longer crash the Python CLI; both CLIs now report "could not parse" and leave the file alone. Metadata parts are also capped at 64 MB decompressed as a zip-bomb defense.
- A directory named `.watermark-cleanerrc` no longer crashes the Node CLI during config lookup.
- The Node CLI rejects unknown flags instead of silently ignoring them (a typo like `--agressive` used to no-op).
- An invalid `WATERMARK_CLEANER_MAX_FILE_BYTES` value now falls back to the default with a warning in both CLIs, instead of crashing (Python) or silently disabling the size limit (Node).
- `check` output now says "would fix" and "would change" instead of claiming files were fixed or changed during a read-only scan.
- The Node CLI honors empty-string dash replacements in `dash_policy` and counts filler-phrase deletions the same way the Python CLI does.
- `watermark-cleaner --version` in the Python package reports the correct version; CI now fails when the three version declarations drift.
- The DeepL rewrite command writes atomically and refuses symlinks, like every other write path.
- The sample git pre-commit hook no longer stages unrelated edits for partially staged files, and `integrations/deploy-gate.sh` now actually blocks on voice errors.
- The Node CLI no longer truncates its output when stdout is a pipe. `check --json | jq` on macOS used to stop at 64 KB with broken JSON because the process exited before the buffered output was written; the CLI now sets the exit code and lets Node flush.
- `fix_dashes: false` now actually keeps em and en dashes. The punctuation table in `rules/typography.json` also listed the four dash codepoints, so the punctuation step replaced them anyway.
- Homoglyph detection is script-aware. Genuine Cyrillic and Greek text is no longer reported as look-alike letters, and `--aggressive` no longer rewrites Russian or Greek words into a latin/cyrillic mix. Only words that mix latin letters with look-alike letters are flagged, plus all-look-alike words in documents without any other Cyrillic or Greek text.
- Four sentence-shape rules (`stop-thinking-start-thinking`, `is-dead-is-the-future`, `the-question-isnt`, `you-dont-need-you-need`) now match the two-sentence form they were written for ("Agile is dead. Flow is the future."). Previously the sentence end between the halves prevented the match and only comma-joined variants were caught. Both test suites now check that every shape matches its own example.
- DOCX and ODT cleaning now also removes the names that used to survive `fix`: author and initials on every comment and tracked change (document body, headers, footers, footnotes, endnotes), the hidden people list (`word/people.xml`), plus application version, template name and total editing time in `docProps/app.xml`. ODT gets the same treatment for annotations and tracked changes in `content.xml`, and `meta.xml` loses editing duration and printed-by. Comments and changes stay, only the name on them is blanked.
- The non breaking space guard now covers real typography instead of only digit pairs: a protected space next to a digit (`10 %`, `5 kg`, `§ 5`, `Nr. 5`), after an ordinal (`5. Mai`) and inside spaced abbreviations (`z. B.`, `d. h.`) is kept. Previously `fix` turned every one of them into a breaking space, so German and French texts lost their line-break protection on each run.
- SVG files that are not valid UTF-8 are skipped with a warning, like text files. Previously `fix` rewrote them anyway: the Python CLI silently dropped every non-ASCII byte ("Caf Mnchen") and the Node CLI wrote replacement characters.
- A file or folder the tool may not read or write no longer aborts the whole run with a stack trace. It is reported per path as `skipped (permission denied)` and every other file is still processed. Both CLIs now also agree on symlinks: a symlink to a directory passed as an argument is scanned (the Node CLI used to scan nothing and report success), symlinked directories inside the tree are never followed, and directory listings are walked in the same byte order.
- More hiding places for invisible characters are covered. The zero width joiner (U+200D) is now removed between ordinary letters and kept only next to emoji or inside scripts that need it; previously it was never touched anywhere. Deprecated format controls (U+206A to U+206F), interlinear annotation characters (U+FFF9 to U+FFFB) and the hangul fillers (U+3164, U+FFA0) are removed, line and paragraph separators (U+2028, U+2029) and the braille blank (U+2800) become normal spaces, and the Mongolian variation selectors (U+180B to U+180D) follow the `--aggressive` rule like the other variation selectors.

## [0.2.1] - 2026-08-14

### Changed

- Project renamed from `wmc-cleaner` to `watermark-cleaner` (package, CLI command, config filename, repository). No behavior change.

## [0.2.0] - 2026-08-13

### Changed

- Image metadata stripping is now lossless. JPEG, PNG and WebP files are cleaned by removing metadata segments at the container level. Pixels are never re-encoded, so there is no quality loss. The Pillow dependency and the `[images]` extra are gone.
- GIF and TIFF files are never modified. The tool reports that lossless stripping is not supported for these formats instead of silently degrading them.
- The zero width non-joiner (U+200C) is only removed when it is not adjacent to a script that requires it (Arabic, Persian, Syriac, Indic scripts, Sinhala, Tibetan, Myanmar, Khmer, Mongolian). Persian and Indic text is no longer corrupted.
- Bidi marks and bidi controls (LRM, RLM, ALM, embeddings, isolates) are kept with a warning when the document contains right-to-left text. In pure left-to-right documents they are removed as before (Trojan Source defense).
- Deleting a filler phrase now repairs the sentence: leftover spaces are removed and the first letter after the deletion is capitalized when the phrase opened a sentence.
- "let's explore", "let's unpack" and "let's take a closer look" are no longer auto-deleted, because they usually carry an object and deleting them breaks the sentence. They are still flagged as blocking phrases.
- The dash replacement policy can now be overridden per project via the `dash_policy` key in `watermark-cleaner.config.json`.
- The Python package is now built from the repository root, which makes the repo usable directly as a pre-commit hook repository.

- Typography and voice rules no longer touch fenced code blocks, inline code or YAML frontmatter. Invisible characters are still removed inside code (Trojan Source defense). Disable via `protect_code: false`.
- Deleting a filler phrase no longer triggers a whole-document reformat. Cleanup happens only around the deletion point, so indentation, table alignment and markdown line breaks survive.
- ICC color profiles (JPEG APP2, PNG iCCP, WebP ICCP) are kept by default because stripping them visibly shifts colors. Strip them with `strip_icc: true` or `--aggressive`.
- The non breaking space number guard now uses ascii digits in both engines; Python previously accepted all unicode digits while Node did not.
- The Node directory walker no longer follows directory symlinks, which prevents infinite loops, and matches the Python behavior for symlinked files.
- All phrase and shape regexes are compiled once and cached instead of being recompiled per file.
- `watermark-cleaner rewrite` auto-detects the document language via DeepL when `--source-lang` is not given, instead of assuming German, and reports rate limit and quota errors in plain language.

### Added

- The Node CLI accepts `--flag=value` syntax in addition to `--flag value`, matching the Python CLI.
- WebP cleaning also strips C2PA content credential chunks (`JUMB`, `C2PA`, `c2pa`).
- New AI phrases in the rulebook: "a myriad of", "a plethora of", "beacon of", "fostering a culture of", "rich tapestry", "at the forefront of" and "demystify" block; "poised to" warns.
- Safe writes: cleaned files are written atomically (temp file plus rename), writes through symlinks are refused with a warning, and files larger than `max_file_bytes` (default 256 MiB, env `WATERMARK_CLEANER_MAX_FILE_BYTES`) are skipped instead of loaded into memory.
- Supply chain hardening: all GitHub Actions are pinned to commit SHAs, workflows run with least-privilege permissions, plus CodeQL analysis, Dependabot updates and a pip-audit job.
- Agent skill packaging: `skills/watermark-cleaner/SKILL.md` lets coding agents drive the CLI with an inspect-first workflow.
- `--strict` flag: `watermark-cleaner fix --strict` exits non-zero when blocking findings remain that need a human rewrite.
- `custom_banned_phrases` and `ignore_phrases` config keys for project-specific rule tuning.
- `.pre-commit-hooks.yaml` with `watermark-cleaner-fix` and `watermark-cleaner-check` hooks for the pre-commit framework.
- `--version` flag in both CLIs.
- Cross-implementation parity test that runs the same fixtures through the Python and the Node CLI and asserts identical output.
- CI test matrix across Python 3.9 to 3.13 and Node 18 to 22, a rules-sync check and a package install smoke test.
- Release workflow that publishes to PyPI and npm via trusted publishing.
- Clean error reports for paths that do not exist and for non-UTF-8 files in the Node CLI, matching the Python behavior.
- `.tif`/`.tiff` handling in the Node CLI, matching the Python defaults.

## [0.1.0] - 2026-08-12

### Added

- Initial release: Python and Node CLI with shared rules for characters, homoglyphs, typography and voice, SVG and raster metadata handling, DeepL rewrite, pre-commit and deploy-gate integrations.
