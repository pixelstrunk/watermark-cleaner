# Contributing

Thanks for helping. This project is small on purpose, and contributions that keep it small are the most welcome kind. By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## The one rule that matters

Python and Node must behave identically. Every change to cleaning behavior needs three things:

1. The rule change in `rules/*.json` (single source of truth), then run `bash scripts/sync-rules.sh` to copy it into both packages.
2. If code changes are needed, matching changes in `python/watermark-cleaner/` and `node/src/`.
3. A test in `tests/` (Python), a test in `node/test/run.js` (Node), and ideally a line in `tests/fixtures/parity/sample.md` so the parity check covers it.

CI enforces this: the rules-sync job fails when the rule files drift apart, and the parity job fails when the two CLIs produce different output.

## Dev setup

```
git clone https://github.com/pixelstrunk/watermark-cleaner
cd watermark-cleaner

python3 -m unittest discover -s tests
node node/test/run.js
bash scripts/check-parity.sh
```

No dependencies are needed for either implementation.

## Contributing rules (phrases, characters)

This is the easiest way to contribute and needs no code. The rulebook lives in `rules/`:

- `phrases.json` holds the AI phrase lists. `banned_phrases` block, `safe_delete_phrases` are auto-removed, `lexicon_warn` only warns. Before adding to `safe_delete_phrases`, make sure the phrase never carries an object; "let's explore the API" must not be cut down to "the API".
- `characters.json` holds the invisible character lists. Before adding a codepoint, check it is not required by any script; the zero width non-joiner incident (required in Persian) is the cautionary tale.

Run `bash scripts/sync-rules.sh` after editing, and add a test that shows the new rule working.

## Reporting false positives

A false positive (the tool removed or flagged something it should not have) is the most valuable bug report for this project. Please use the false positive issue template and include the exact input text, escaped if it contains invisible characters.

## Scope

The tool is deterministic and offline by design. Features that require a network call, a language model or a statistical detector are out of scope, with the single existing exception of the opt-in DeepL rewrite.

## Roadmap

Planned next, contributions welcome:

- `--diff` mode: show a unified diff of what `fix` would change without applying it.
- Local rewrite backend: drive `watermark-cleaner rewrite` through a local model (for example Ollama) as a zero-network alternative to DeepL.

Considered and rejected: AST-based markdown parsing (breaks the zero-dependency promise for an edge case the regex protection already covers) and parallel file processing (no real workload needs it yet).
