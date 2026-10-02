# Watermark Cleaner

Remove AI text artifacts, hidden unicode characters and file metadata before you publish.

[![ci](https://github.com/pixelstrunk/watermark-cleaner/actions/workflows/ci.yml/badge.svg)](https://github.com/pixelstrunk/watermark-cleaner/actions/workflows/ci.yml)
[![PyPI](https://img.shields.io/pypi/v/watermark-cleaner?cacheSeconds=3600)](https://pypi.org/project/watermark-cleaner/)
[![npm](https://img.shields.io/npm/v/watermark-cleaner?cacheSeconds=3600)](https://www.npmjs.com/package/watermark-cleaner)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Watermark Cleaner is a deterministic, offline, zero-dependency tool for content you own. It cleans the mechanical traces that mark text as machine generated, removes the citation markers and tracking parameters that assistants leave in copied text, flags the stylistic phrases that read as AI writing (English and German), and strips identifying metadata from images and office documents without touching a single pixel. It ships as a Python CLI and a Node CLI that share one rule set and are tested to behave identically.

## See it

The problem is invisible by definition. Escaped, it looks like this:

```
before   "Sm​art quotes “work” — and a hidden‌ watermark"
after    "Smart quotes \"work\", and a hidden watermark"
```

```
$ watermark-cleaner check post.md
post.md  (1 error, 5 would fix)
  [block] ai phrases present (rewrite required, not auto-fixed) x1  (in today's fast-paced world)
  [would fix] removed zero width space (U+200B) x2
  [would fix] straightened smart quotes x2
  [would fix] replaced em/en dash per policy x1

1 files scanned  |  1 would change  |  5 would fix  |  0 warnings  |  1 blocking
$ echo $?
1
```

`check` reports and never changes anything. `fix` cleans in place and writes a `.bak` backup next to every changed file. The backup keeps the first original: running `fix` again after editing does not overwrite an existing `.bak`.

## Install

| Ecosystem | One-shot | Install |
|---|---|---|
| Python | `uvx watermark-cleaner check .` or `pipx run watermark-cleaner check .` | `pipx install watermark-cleaner` |
| Node | `npx watermark-cleaner check .` | `npm install -g watermark-cleaner` |
| pre-commit | see below | `.pre-commit-config.yaml` snippet |
| From source | | `pip install .` or `npm install -g ./node` |

Both packages install a single command, `watermark-cleaner`, available in every folder, like git.

## Use

```
watermark-cleaner check .          # report only, changes nothing, exits non zero if blocked
watermark-cleaner fix .            # clean in place, writes a .bak backup per changed file
watermark-cleaner check post.md
watermark-cleaner fix ./content --no-voice
watermark-cleaner fix ./assets --aggressive     # also replace homoglyphs and strip variation selectors
watermark-cleaner check . --json
watermark-cleaner check . --strict        # exit 1 when anything would change, for ci
pbpaste | watermark-cleaner fix - | pbcopy   # clean the clipboard (macos); report goes to stderr
```

`check` is safe to run over an entire folder to see what is inside without touching anything. Exit codes: `check` returns 1 when a file contains AI phrases or AI sentence shapes, so it works as a publish gate. `check --strict` also returns 1 when anything would change, which turns it into a CI lint for hidden characters and metadata. `fix` returns 0 after cleaning what it can; pass `--strict` to make `fix` return 1 when blocking findings remain that need a human rewrite.

A single `-` instead of a path reads standard input. `fix -` writes the cleaned text to stdout and the report to stderr, so it drops into a pipe: copy text from a chat, run it through the cleaner, paste the result.

Markdown structure is protected: typography, voice, entity and artifact rules never touch fenced code blocks, inline code (single or double backticks) or YAML frontmatter, so code examples in documentation survive cleaning. Invisible characters are still removed inside code, because hidden characters in code are exactly the Trojan Source attack this tool defends against. Disable with `"protect_code": false` if you want full-document typography.

## What it removes, and what it deliberately keeps

| Category | Codepoints | Action |
|---|---|---|
| Zero width space, word joiner, BOM | U+200B, U+2060, U+FEFF | removed |
| Soft hyphen, mongolian vowel separator, combining grapheme joiner | U+00AD, U+180E, U+034F | removed |
| Invisible math operators | U+2061 to U+2064 | removed |
| Deprecated format controls, interlinear annotation characters, hangul fillers | U+206A to U+206F, U+FFF9 to U+FFFB, U+3164, U+FFA0 | removed |
| Unicode tag characters (hidden payloads, tag space) | U+E0000 to U+E007F | removed, except inside well-formed subdivision flag emoji |
| Private use characters (ChatGPT citation delimiters U+E200 to U+E203 and everything else vendors hide there) | U+E000 to U+F8FF, planes 15 and 16 | removed |
| Noncharacters | U+FDD0 to U+FDEF, U+FFFE, U+FFFF | removed |
| Hangul fillers | U+115F, U+1160, U+3164, U+FFA0 | removed |
| Variation selectors without a base that supports them (letters, spaces, selector chains) | U+FE00 to U+FE0F, U+E0100 to U+E01EF, U+180B to U+180D | removed; after emoji, symbols, digits and CJK they stay |
| HTML entities of all of the above (`&#8203;`, `&zwnj;`, `&shy;`, `&#xFEFF;`) | decoded, then the same rules apply | removed |
| Assistant copy artifacts (`citeturn0search0`, `[cite: 1]`, `【1†source】`, `utm_source=chatgpt.com`) | per `rules/artifacts.json` | removed |
| Exotic spaces and blanks (nbsp, thin space, ideographic space, line and paragraph separator, braille blank) | U+00A0, U+2000 to U+200A, U+202F, U+205F, U+3000, U+2028, U+2029, U+2800 | replaced with a normal space |
| Smart quotes, ellipsis, bullets, dashes, typographic hyphens | U+2018, U+2010, U+2011 and friends | normalized to ascii |
| Homoglyphs (cyrillic і inside a latin word and friends) | per rulebook | warned, replaced only with `--aggressive` |

Deliberately preserved, because removing them breaks legitimate text:

- Subdivision flag emoji (England, Scotland, Wales). They are a black flag followed by tag characters and a cancel tag; the well-formed sequence stays, a tag character anywhere else is removed.
- Zero width joiner (U+200D) next to an emoji or inside a script that requires it (Indic scripts, Arabic). Between latin letters it is a watermark and gets removed.
- Zero width non-joiner (U+200C) when adjacent to a script that requires it (Persian, Arabic, Indic scripts and others). Between latin letters it is a watermark and gets removed.
- Bidi marks and bidi controls in documents that contain right-to-left text. In pure left-to-right documents they are removed, which is the [Trojan Source](https://trojansource.codes/) defense.
- Non breaking spaces next to a digit (`12 000`, `10 %`, `5 kg`, `§ 5`, `Nr. 5`), after an ordinal (`5. Mai`), inside spaced abbreviations (`z. B.`, `d. h.`, `i. d. R.`) and in French punctuation (`Il dit : bonjour !`, `« Oui »`). Everywhere else, between two words or between two sentences, a non breaking space is a watermark and becomes a normal space. Disable the guard with `keep_nbsp_in_numbers: false`.
- A spaced dash between two numbers (`10 – 20 Uhr`, `1990 — 2000`) becomes a plain hyphen, never the comma from `dash_policy`, because a range is not an enumeration.
- Variation selectors that belong to something: `❤️`, keycaps like `1️⃣`, `©️`, CJK ideographic variations and Mongolian free variation selectors. A selector after a latin letter, a space or another selector carries no meaning and is removed as a hidden payload.
- The combining grapheme joiner (U+034F) next to Hebrew and the braille blank (U+2800) inside braille text.
- Genuine Cyrillic and Greek text. Homoglyph detection works per word: a word that mixes latin letters with look-alike letters is flagged, a word written entirely in Cyrillic or Greek is normal text and stays untouched even with `--aggressive`. A word that consists only of look-alike letters (`СОРЕ` spelled in Cyrillic) is flagged only when the document contains no other Cyrillic or Greek text.

## Coverage

| Channel | Handled | Notes |
|---|---|---|
| Invisible/format Unicode (ZWSP, bidi, tag chars, private use, variation selector payloads, homoglyphs) | Yes | Deterministic, verifiable |
| HTML entity forms of invisible characters | Yes | Decoded, then the character rules apply |
| Assistant copy artifacts (citation markers, tracking parameters) | Yes | Deterministic, from `rules/artifacts.json` |
| Typography (smart quotes, dashes, ellipsis) | Yes | Deterministic, verifiable |
| AI filler phrases and sentence shapes | English and German | Filler removed (English only), shapes flagged |
| Image metadata: EXIF, XMP, C2PA, comments | JPEG, PNG, WebP, SVG | Lossless, container-level |
| Image metadata: GIF, TIFF, HEIC, HEIF, AVIF | No | Reported, file left untouched |
| Document metadata: DOCX, PPTX, XLSX, ODT, ODP, ODS | Yes | Lossless, container-level (see below) |
| Document metadata: PDF | Reported only | `check` lists author, creator, producer and XMP presence; the file is never rewritten, see [Non-goals](#non-goals-stated-plainly) |
| Statistical/token-level text watermarks (SynthID-Text in Gemini and, since August 2026, Claude) | Best-effort only, opt-in | Via [DeepL rewrite](#optional-deepl-rewrite), not a deterministic strip |
| Pixel-domain image watermarks | No | Out of scope, see below |
| Training-time backdoors | No | Out of scope, not a watermarking concern this tool addresses |

## Image metadata, losslessly

`watermark-cleaner fix` strips EXIF, XMP, C2PA and comment segments from JPEG, PNG and WebP at the container level. Pixels are never re-encoded, so there is no quality loss and the operation is verifiable with a byte diff. ICC color profiles are kept by default, because removing them visibly shifts colors in the browser; strip them too with `"strip_icc": true` or `--aggressive`. SVG metadata, XMP blocks and XML comments are removed as text; an SVG that is not valid UTF-8 (older Illustrator exports in ISO-8859-1, for example) is skipped with a warning instead of being re-encoded. GIF and TIFF are never modified; the tool tells you it cannot strip them losslessly and leaves them alone. Files that fail to parse are left untouched.

## Document metadata, losslessly

DOCX, PPTX, XLSX, ODT, ODP and ODS are ZIP containers. `watermark-cleaner fix` removes the people and the software from them, container-level and lossless. For DOCX that means the author and last-editor fields in `docProps/core.xml`, the application name, application version, template name and total editing time in `docProps/app.xml`, the hidden people list in `word/people.xml`, and the author names and initials on every comment and tracked change in the document body, headers, footers and notes. Comments and tracked changes themselves stay in place, only the name on them is blanked. PPTX and XLSX get the same core and app treatment plus the names and initials of comment authors (`ppt/commentAuthors.xml`, `ppt/authors.xml`, `xl/comments*.xml`, `xl/persons/person.xml`). For ODT, ODP and ODS it means creator, initial creator, generator, editing duration and printed-by in `meta.xml` plus the creator on every annotation and tracked change in `content.xml`. Every part that carries no such field, including styles and embedded images, is copied through byte-for-byte, verifiable with a byte diff exactly like the image path. Rewritten parts are stored uncompressed so both CLIs produce identical bytes; a document with heavy tracked changes can therefore grow by a few hundred kilobytes. Title, subject, keywords, description and edit dates are left alone; those are content you likely want, not a machine fingerprint. Files that fail to parse as a well-formed ZIP are left untouched. PDF is scanned read-only: `check` tells you when author, creator, producer, XMP or a C2PA manifest is present, and both commands leave the file alone.

## Use as a publish gate

With the [pre-commit](https://pre-commit.com) framework:

```yaml
repos:
  - repo: https://github.com/pixelstrunk/watermark-cleaner
    rev: v0.3.0
    hooks:
      - id: watermark-cleaner-fix
```

`watermark-cleaner-fix` cleans the mechanical layers on every commit and never blocks on style. Add `id: watermark-cleaner-check` if you also want commits blocked on AI phrases. A plain git hook and a deploy gate script live in [`integrations/`](integrations/).

Coding agents can drive the CLI through the skill in [`skills/watermark-cleaner/`](skills/watermark-cleaner/), which enforces an inspect-first workflow.

All writes are safe by construction: files are replaced atomically, writes through symlinks are refused, and files larger than `max_file_bytes` (default 256 MiB) are skipped instead of loaded into memory. A file or folder the tool is not allowed to read or write is reported as a warning and skipped; the run continues with the next file instead of aborting.

## The voice layer, honestly

Cleaning AI text falls into buckets, and this tool is precise about which bucket each action lives in.

| Layer | What | Result |
|---|---|---|
| Characters | Invisible and format characters, exotic spaces, homoglyphs, NFC normalization | Fixed, 100% verifiable |
| Typography | Smart quotes, ellipsis and bullet glyphs, em and en dashes | Fixed, 100% verifiable |
| File metadata | EXIF, XMP and C2PA in images, metadata and comments in SVG, author/app fields in DOCX and ODT | Stripped losslessly, 100% verifiable |
| Voice | AI filler phrases and AI sentence shapes from a portable rulebook | Filler removed, shapes flagged and blocked |

The voice layer auto-deletes only phrases that are pure filler ("without further ado"). When a deletion opens a sentence, the sentence is repaired: leftover spaces go away and the next word is capitalized. Phrases that carry an object ("let's explore the API") are never cut mid-sentence; they are flagged as errors for a human to rewrite. The rulebook covers English and German. German phrases are only ever flagged, never deleted, because removing a German clause opener changes the word order of what follows. Chat residue such as "Certainly! Here's" or "I hope this helps" blocks outright; it is the clearest sign that text was pasted from an assistant.

## Non-goals, stated plainly

- It does not remove statistical text watermarks. Google has embedded SynthID-Text in Gemini output since 2024, and Anthropic announced in August 2026 that all Claude models released after 2 August 2026 carry the same kind of watermark; OpenAI has not deployed one for text. These watermarks live in word choice, add no hidden characters, survive light editing and disappear only under a complete rewrite. No character-level tool can detect or remove them, and no public detector exists to verify removal. The April 2025 reports of ChatGPT inserting narrow no-break spaces were a training artifact that OpenAI removed within days, not a watermark; this tool removes those spaces anyway.
- It does not auto-rewrite AI sentence shapes. Rewriting a sentence needs judgment, so the tool detects and blocks those shapes instead of replacing them and producing nonsense.
- It does not certify that text will pass any AI detector, and it is not a way to misrepresent authorship.
- It does not rewrite PDF files. Lossless PDF editing needs a full object parser, and an incremental update would leave the old metadata in the file for anyone who looks. `check` reports what a PDF carries; to strip it, use `exiftool -all= file.pdf` or `qpdf`, or export to a supported format before running the cleaner.
- It does not detect or remove pixel-domain image watermarks (SynthID-class, StegaStamp, Tree-Ring and similar signals embedded in the pixels themselves). That is a fundamentally different, model-heavy problem; this tool only ever touches metadata containers and text, never re-encodes pixels.
- It does not address training-time backdoors or any watermarking mechanism baked into a model's weights. Out of scope for a client-side content cleaner.

## Configure

Drop a `watermark-cleaner.config.json` in a project root. Any key overrides the default.

```json
{
  "voice": true,
  "replace_homoglyphs": false,
  "keep_nbsp_in_numbers": true,
  "protect_code": true,
  "strip_icc": false,
  "dash_policy": { "spaced_replacement": " - ", "unspaced_replacement": "-" },
  "custom_banned_phrases": ["our innovative product", "leverage synergies"],
  "ignore_phrases": ["delve", "not-only-but-also"],
  "text_extensions": [".md", ".mdx", ".txt"],
  "exclude": ["node_modules", ".git", "dist"]
}
```

By default a spaced em dash ("fast — slow") becomes a comma ("fast, slow") and an unspaced one becomes a hyphen. That is an opinionated policy; `dash_policy` lets you change both replacements per project.

`custom_banned_phrases` adds your own blocking phrases on top of the rulebook. `ignore_phrases` switches off any built-in phrase, lexicon word or sentence shape id that does not fit your domain.

## Optional DeepL rewrite

```
export DEEPL_API_KEY=your-key
watermark-cleaner rewrite post.md
watermark-cleaner rewrite post.md --source-lang DE --pivot-lang EN
watermark-cleaner rewrite post.md --write
```

The document language is auto-detected by DeepL when `--source-lang` is not given.

This back translates the text (source to pivot and back) using a model that is not the one that wrote the text, then runs the deterministic cleaner on the result. It changes word choice, which is what degrades a statistical watermark, but it can shift meaning and it sends your text to DeepL. It is off by default and opt in. Do not use it on confidential content. It cannot certify that any vendor detector will fail.

## Rules are one source

All character lists, phrase lists and copy-artifact patterns live in [`rules/*.json`](rules/). The Python and Node packages read the same files, `scripts/sync-rules.sh` copies them into each package, and CI fails when they drift or when the two CLIs produce different output. Edit the rules once, both tools follow. Contributions to the rulebook are the easiest way to help; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Scope and intent

This tool is for hygiene, privacy and transparency on content you own: see what is hidden in your text, and publish without machine fingerprints you did not choose to include.

## License

[MIT](LICENSE)
