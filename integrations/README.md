# Integrations

Three ready patterns for running Watermark Cleaner automatically.

## pre-commit framework (recommended)

The repository ships hook definitions for [pre-commit](https://pre-commit.com). Add this to your `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/pixelstrunk/watermark-cleaner
    rev: v0.2.0
    hooks:
      - id: watermark-cleaner-fix
```

`watermark-cleaner-fix` cleans the mechanical layers (invisible characters, typography, image metadata) on every commit and never blocks on style. Add `watermark-cleaner-check` as a second hook if you also want commits blocked when AI phrases are present:

```yaml
      - id: watermark-cleaner-check
```

## Plain git hook

If you do not use the pre-commit framework, copy `pre-commit` from this folder into a repository at `.git/hooks/pre-commit` and make it executable:

```
cp integrations/pre-commit /path/to/repo/.git/hooks/pre-commit
chmod +x /path/to/repo/.git/hooks/pre-commit
```

It runs `watermark-cleaner fix --no-voice --no-backup` on every staged text and image file and re-stages the cleaned result. It requires `watermark-cleaner` to be installed globally and exits silently when it is not.

## Deploy gate

Call `deploy-gate.sh` from your deploy script before the build step. It runs the mechanical clean on your content directory (default `content`, override with `WATERMARK_CLEANER_CONTENT_DIR`) and fails only when `watermark-cleaner` is missing.

## Why the defaults run with --no-voice

If your project already has a voice or prose linter, let that tool own stylistic blocking and let Watermark Cleaner own the mechanical clean. Turn the voice layer on in a gate only where you want Watermark Cleaner to be the enforcer.
