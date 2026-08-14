# Watermark Cleaner

Remove AI text artifacts, hidden unicode characters and file metadata before you publish.

[![ci](https://github.com/pixelstrunk/watermark-cleaner/actions/workflows/ci.yml/badge.svg)](https://github.com/pixelstrunk/watermark-cleaner/actions/workflows/ci.yml)
[![PyPI](https://img.shields.io/pypi/v/watermark-cleaner)](https://pypi.org/project/watermark-cleaner/)
[![npm](https://img.shields.io/npm/v/watermark-cleaner)](https://www.npmjs.com/package/watermark-cleaner)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Watermark Cleaner is a deterministic, offline, zero-dependency tool for content you own. It cleans the mechanical traces that mark text as machine generated, flags the stylistic phrases that read as AI writing, and strips identifying metadata from images without touching a single pixel. It ships as a Python CLI and a Node CLI that share one rule set and are tested to behave identically.

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
```

`check` is safe to run over an entire folder to see what is inside without touching anything. Exit codes: `check` returns 1 when a file contains AI phrases or AI sentence shapes, so it works as a publish gate. `fix` returns 0 after cleaning what it can; pass `--strict` to make `fix` return 1 when blocking findings remain that need a human rewrite.

Markdown structure is protected: typography and voice rules never touch fenced code blocks, inline code or YAML frontmatter, so code examples in documentation survive cleaning. Invisible characters are still removed inside code, because hidden characters in code are exactly the Trojan Source attack this tool defends against. Disable with `"protect_code": false` if you want full-document typography.

## What it removes, and what it deliberately keeps

| Category | Codepoints | Action |
|---|---|---|
| Zero width space, word joiner, BOM | U+200B, U+2060, U+FEFF | removed |
| Soft hyphen, mongolian vowel separator, combining grapheme joiner | U+00AD, U+180E, U+034F | removed |
| Invisible math operators | U+2061 to U+2064 | removed |
| Unicode tag characters (hidden payloads) | U+E0000 to U+E007F | removed |
| Exotic spaces (nbsp, thin space, ideographic space and friends) | U+00A0, U+2000 to U+200A, U+202F, U+205F, U+3000 | replaced with a normal space |
| Smart quotes, ellipsis, bullets, dashes | U+2018 and friends | normalized to ascii |
| Homoglyphs (cyrillic і in latin text and friends) | per rulebook | warned, replaced only with `--aggressive` |

Deliberately preserved, because removing them breaks legitimate text:

- Zero width joiner (U+200D) in emoji sequences.
- Zero width non-joiner (U+200C) when adjacent to a script that requires it (Persian, Arabic, Indic scripts and others). Between latin letters it is a watermark and gets removed.
- Bidi marks and bidi controls in documents that contain right-to-left text. In pure left-to-right documents they are removed, which is the [Trojan Source](https://trojansource.codes/) defense.
- Non breaking spaces between digits (`12 000` keeps its formatting) unless you disable `keep_nbsp_in_numbers`.
- Variation selectors, unless you pass `--aggressive`.

## Coverage

| Channel | Handled | Notes |
|---|---|---|
| Invisible/format Unicode (ZWSP, bidi, tag chars, homoglyphs) | Yes | Deterministic, verifiable |
| Typography (smart quotes, dashes, ellipsis) | Yes | Deterministic, verifiable |
| AI filler phrases and sentence shapes | Yes | Filler removed, shapes flagged |
| Image metadata: EXIF, XMP, C2PA, comments | JPEG, PNG, WebP, SVG | Lossless, container-level |
| Image metadata: GIF, TIFF | No | Reported, file left untouched |
| Document metadata: DOCX, ODT | Yes | Lossless, container-level (see below) |
| Document metadata: PDF | Not yet | See [Non-goals](#non-goals-stated-plainly) |
| Statistical/token-level text watermarks (SynthID-style) | Best-effort only, opt-in | Via [DeepL rewrite](#optional-deepl-rewrite), not a deterministic strip |
| Pixel-domain image watermarks | No | Out of scope, see below |
| Training-time backdoors | No | Out of scope, not a watermarking concern this tool addresses |

## Image metadata, losslessly

`watermark-cleaner fix` strips EXIF, XMP, C2PA and comment segments from JPEG, PNG and WebP at the container level. Pixels are never re-encoded, so there is no quality loss and the operation is verifiable with a byte diff. ICC color profiles are kept by default, because removing them visibly shifts colors in the browser; strip them too with `"strip_icc": true` or `--aggressive`. SVG metadata, XMP blocks and XML comments are removed as text. GIF and TIFF are never modified; the tool tells you it cannot strip them losslessly and leaves them alone. Files that fail to parse are left untouched.

## Document metadata, losslessly

DOCX and ODT are ZIP containers. `watermark-cleaner fix` strips the author, last-editor and creating-application fields from the small metadata part inside them (`docProps/core.xml` and `docProps/app.xml` for DOCX, `meta.xml` for ODT) and rewrites the archive with every other part, including the document body, styles and embedded images, copied through byte-for-byte, verifiable with a byte diff exactly like the image path. Title, subject, keywords and description are left alone; those are content you likely want, not a machine fingerprint. Files that fail to parse as a well-formed ZIP are left untouched. PDF is not supported yet.

## Use as a publish gate

With the [pre-commit](https://pre-commit.com) framework:

```yaml
repos:
  - repo: https://github.com/pixelstrunk/watermark-cleaner
    rev: v0.2.1
    hooks:
      - id: watermark-cleaner-fix
```

`watermark-cleaner-fix` cleans the mechanical layers on every commit and never blocks on style. Add `id: watermark-cleaner-check` if you also want commits blocked on AI phrases. A plain git hook and a deploy gate script live in [`integrations/`](integrations/).

Coding agents can drive the CLI through the skill in [`skills/watermark-cleaner/`](skills/watermark-cleaner/), which enforces an inspect-first workflow.

All writes are safe by construction: files are replaced atomically, writes through symlinks are refused, and files larger than `max_file_bytes` (default 256 MiB) are skipped instead of loaded into memory.

## The voice layer, honestly

Cleaning AI text falls into buckets, and this tool is precise about which bucket each action lives in.

| Layer | What | Result |
|---|---|---|
| Characters | Invisible and format characters, exotic spaces, homoglyphs, NFC normalization | Fixed, 100% verifiable |
| Typography | Smart quotes, ellipsis and bullet glyphs, em and en dashes | Fixed, 100% verifiable |
| File metadata | EXIF, XMP and C2PA in images, metadata and comments in SVG, author/app fields in DOCX and ODT | Stripped losslessly, 100% verifiable |
| Voice | AI filler phrases and AI sentence shapes from a portable rulebook | Filler removed, shapes flagged and blocked |

The voice layer auto-deletes only phrases that are pure filler ("without further ado"). When a deletion opens a sentence, the sentence is repaired: leftover spaces go away and the next word is capitalized. Phrases that carry an object ("let's explore the API") are never cut mid-sentence; they are flagged as errors for a human to rewrite. The phrase rulebook is currently English only.

## Non-goals, stated plainly

- It does not remove statistical text watermarks (the SynthID style signal that some vendors embed in word choice). No deterministic tool can, and there is no public detector to verify removal. Only substantial rewriting degrades that signal.
- It does not auto-rewrite AI sentence shapes. Rewriting a sentence needs judgment, so the tool detects and blocks those shapes instead of replacing them and producing nonsense.
- It does not certify that text will pass any AI detector, and it is not a way to misrepresent authorship.
- It does not touch PDF metadata yet. That is a real gap for a "clean before you publish" tool and may land in a future release; today the safest path is to export to a supported format before running the cleaner.
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

All character lists and phrase lists live in [`rules/*.json`](rules/). The Python and Node packages read the same files, `scripts/sync-rules.sh` copies them into each package, and CI fails when they drift or when the two CLIs produce different output. Edit the rules once, both tools follow. Contributions to the rulebook are the easiest way to help; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Scope and intent

This tool is for hygiene, privacy and transparency on content you own: see what is hidden in your text, and publish without machine fingerprints you did not choose to include.

## License

[MIT](LICENSE)
