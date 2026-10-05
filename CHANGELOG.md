# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Browser entry `watermark-cleaner/browser`: the same cleaner without any file system access, with the rules bundled. Exports `cleanText(text, config?, rules?)` with the CLI defaults, `classifyCharacters(text)` (per code point: `keep`, `remove` or `space` plus the rule name, taken from the same decision table the cleaner uses), `findPhrases(text)` (every voice hit with `start`, `end`, `kind` banned/filler/shape/lexicon, `id`, `severity` and the matched text, code spans excluded, same regexes as the voice layer), the lossless image strippers `stripJpeg`, `stripPng`, `stripWebp` on `Uint8Array`, plus `DEFAULTS` and `RULES`. The Node entry exports the same functions on top of `cleanText`. TypeScript definitions ship with the package.
- Every finding now carries `by_rule`, the count per rule id: artifacts (`{"chatgpt-citation-token": 2, "utm_source-tracking": 1}`), voice (per phrase, shape id or lexicon word), typography (per code point, dash `range`/`spaced`/`unspaced`, `dot-run`), entities (per entity as written), homoglyphs and characters (per code point). Both CLIs emit it in `--json`.
- EXIF orientation survives image cleaning. Photos from phones carry the rotation in EXIF tag 0x0112; stripping the whole block made them show sideways. Both CLIs now read the tag before stripping and, when it is 2 to 8, write back a minimal 26-byte EXIF block that contains only this tag: a 36-byte APP1 behind JFIF for JPEG (right after SOI when there is no APP0), an `eXIf` chunk behind IHDR for PNG, a trailing `EXIF` chunk with the VP8X flag kept for WebP. Pixels stay untouched, every other tag is gone, and the report says `kept exif orientation (tag 0x0112), nothing else`. Cleaning an already cleaned photo is a no-op.

### Changed

- **Breaking:** `package.json` now has an `exports` field. Only `watermark-cleaner` and `watermark-cleaner/browser` can be imported; deep imports of `watermark-cleaner/src/...` and `watermark-cleaner/rules_data/...` stop working. Rule data is reachable as `RULES` from the browser entry and `loadRules()` from the Node entry.
- The Node package is split into file-system-free modules (`defaults.js`, `protect.js`, `pipeline.js`, `layers.js`, `image.js`) and the two entries on top; behaviour of the CLI is unchanged.

### Migration for web integrations (0.3.0 to 0.4.0)

Replace the three deep imports with the browser entry:

```js
import { cleanText, classifyCharacters, findPhrases, stripJpeg, stripPng, stripWebp, RULES } from "watermark-cleaner/browser";
```

- A hand-built pipeline (layer order, code protection) becomes `cleanText(text)`; per-rule counters such as "2 citation leftovers, 1 tracking link" come from `report.findings[i].by_rule` instead of running the layer twice with halved rules.
- A character reveal built on `rules_data/characters.json` becomes `classifyCharacters(text)`; typography glyphs (quotes, dashes) are still a lookup in `RULES.typography`.
- Phrase highlighting built on `rules_data/phrases.json` becomes `findPhrases(text)`; hits are sorted by start, overlaps are left to the caller, and hits inside a filler phrase that the cleaner deletes are not reported.
- A copied image stripper becomes `stripJpeg(bytes)`, `stripPng(bytes)`, `stripWebp(bytes)` on a `Uint8Array`; the result has `cleaned`, `stripped` and `orientation`.
- Delete the local `watermark-cleaner.d.ts` shim, the package ships its own types.

### Fixed

- Removing a copy artifact (`citeturn0search0`, `[cite: 1]`, `【1†source】` and the other `remove_patterns`) no longer leaves a double space behind. One space stays between words, none stays before punctuation (`Fact citeturn0search0.` becomes `Fact.`), and tokens at the start or end of a line take their neighbouring space with them. Both CLIs behave the same and the parity fixtures cover it.

## [0.3.0] - 2026-10-02

### Added

- Read from stdin: `watermark-cleaner fix -` cleans standard input and writes the cleaned text to stdout with the report on stderr, so `pbpaste | watermark-cleaner fix - | pbcopy` cleans the clipboard. `check -` reports on stdin without writing anything.
- `check --strict` exits 1 when anything would change, not only on blocking phrases. Use it as a CI gate for hidden characters and metadata.
- Assistant copy artifacts are removed: private-use characters (ChatGPT's citation delimiters U+E200 to U+E203 and every other private-use codepoint), the leftover tokens `citeturn0search0`, `[cite: 1]`, `[span_1](start_span)`, `【1†source】` and `grok_render_citation_card_json`, plus `utm_source=chatgpt.com|openai|perplexity|copilot.microsoft.com|gemini.google.com` tracking parameters in links. Links to Perplexity upload buckets are reported as a warning. Rules live in `rules/artifacts.json`; the layer skips code blocks.
- HTML entities that encode invisible characters (`&#8203;`, `&#x200B;`, `&zwnj;`, `&zwj;`, `&shy;`, `&#65279;`, `&ZeroWidthSpace;`, bidi and tag entities) are decoded and then handled by the character rules, so a zero width space hidden as an entity in HTML or Markdown no longer passes. `&nbsp;` and other visible-width entities are left alone, and entities inside code spans are treated as documentation.
- PPTX, XLSX, ODP and ODS metadata stripping: core and app properties like DOCX, plus comment author names and initials (`ppt/commentAuthors.xml`, `ppt/authors.xml`, `xl/comments*.xml`, `xl/persons/person.xml`).
- PDF files are now scanned read-only: `check` reports when `/Author`, `/Creator`, `/Producer`, XMP or a C2PA manifest is present and says that the file is not rewritten. HEIC, HEIF and AVIF are reported as unsupported like GIF and TIFF instead of being silently ignored.
- Variation selectors are removed by default when they follow a character that cannot carry one (a letter, a space, another selector, the start of text), which closes the data smuggling channel through `U+FE00` to `U+FE0F` and `U+E0100` to `U+E01EF`. Selectors after emoji, symbols, digits (keycaps), CJK ideographs and Mongolian letters stay. `--aggressive` still strips them all.
- New invisible characters: Hangul choseong and jungseong fillers (U+115F, U+1160) and the noncharacters U+FDD0 to U+FDEF, U+FFFE, U+FFFF. U+2010 hyphen and U+2011 non-breaking hyphen become an ascii hyphen.
- Phrase rulebook refresh from the July 2026 Wikipedia list and current detector research: chat residue blocks (`Certainly! Here's`, `I hope this helps`, `Let me know if you`, `As an AI language model`), significance phrases block (`plays a crucial role`, `cannot be overstated`, `serves as a testament`, `setting the stage for`), new warn shapes `participial-tail` (", highlighting the importance of"), `copula-avoidance` ("serves as a") and `no-no-just`, plus about thirty new lexicon words (`boasts`, `nestled`, `meticulous`, `interplay`, `landscape`, `showcasing`).
- First German rules: blocking phrases (`in der heutigen digitalen Welt`, `es ist wichtig zu beachten, dass`, `zusammenfassend lässt sich sagen`, `als KI-Sprachmodell`, `spielt eine entscheidende Rolle`), the shapes `nicht-nur-sondern-auch` (warn) and `es-geht-nicht-um-es-geht-um` (block), lexicon warnings (`essenziell`, `nahtlos`, `maßgeschneidert`, `ganzheitlich`, `wegweisend`) and transition tics (`zudem`, `ferner`, `des Weiteren`, `darüber hinaus`). German phrases are never auto-deleted because German subordinate clauses change word order.
- DOCX and ODT metadata stripping (`docProps/core.xml` and `docProps/app.xml` for DOCX, `meta.xml` for ODT): author, last-editor and creating-application fields are removed, container-level and lossless, with every other part of the archive copied through byte-for-byte. PDF is not supported yet.
- Config files are now validated on load: wrong types (for example `"voice": 0`) fail with a clear message and exit code 2 instead of behaving differently per CLI.
- Per-shape severity in the phrase rulebook. `not-only-but-also` and `less-x-more-y` now warn instead of block, because they flag ordinary English too often.
- Parity CI now also compares the `--json` reports of both CLIs, not just file bytes and exit codes, and includes a CRLF fixture.

### Fixed

- Subdivision flag emoji (England, Scotland, Wales) are no longer destroyed. They are built from a black flag plus tag characters and the tag characters were removed unconditionally; well-formed flag sequences now stay while every other tag character, including the tag space used in 2026 phishing campaigns, is still removed.
- A spaced dash between two numbers (`10 – 20 Uhr`, `1990 — 2000`) becomes a hyphen instead of the configured comma, which used to change the meaning of ranges.
- French typography survives: the narrow no-break space before `: ; ! ? »` and after `«` is kept like the number guard keeps `12 000`. Disable with `keep_nbsp_in_numbers: false`.
- DOCX files written by Java libraries (Apache POI and friends) use streamed ZIP entries. After cleaning, the local header of an unmodified entry still announced a data descriptor that was no longer there, which broke sequential readers such as Java's ZipInputStream. Every local header is now written from the central directory values.
- Inline code with double backticks (`` `` like ` this `` ``) is protected from typography and voice rules like single-backtick code.
- U+034F combining grapheme joiner is kept next to Hebrew text, where Unicode 17 documents a legitimate use. U+2800 braille blank is kept inside braille text.
- `check` now counts images and documents with strippable metadata as "would change" and labels them "would fix", consistent with text files. They used to be reported as warnings.
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

### Changed

- Default layers are now `entities, characters, homoglyphs, typography, voice, artifacts`. Projects that set `layers` explicitly need to add `entities` and `artifacts` to get the new behavior.
- Default `document_extensions` include `.pptx`, `.xlsx`, `.odp`, `.ods` and `.pdf`; default `image_extensions` include `.heic`, `.heif` and `.avif`.
- CI tests Python 3.9, 3.12 and 3.14 and Node 20, 22 and 24. Node 18 still works but is no longer tested because it reached end of life.

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
