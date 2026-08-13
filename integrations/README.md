# Integrations

Three ready patterns for running WMC Cleaner automatically.

## pre-commit framework (recommended)

The repository ships hook definitions for [pre-commit](https://pre-commit.com). Add this to your `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/pixelstrunk/wmc-cleaner
    rev: v0.2.0
    hooks:
      - id: wmc-fix
```

`wmc-fix` cleans the mechanical layers (invisible characters, typography, image metadata) on every commit and never blocks on style. Add `wmc-check` as a second hook if you also want commits blocked when AI phrases are present:

```yaml
      - id: wmc-check
```

## Plain git hook

If you do not use the pre-commit framework, copy `pre-commit` from this folder into a repository at `.git/hooks/pre-commit` and make it executable:

```
cp integrations/pre-commit /path/to/repo/.git/hooks/pre-commit
chmod +x /path/to/repo/.git/hooks/pre-commit
```

It runs `wmc fix --no-voice --no-backup` on every staged text and image file and re-stages the cleaned result. It requires `wmc` to be installed globally and exits silently when it is not.

## Deploy gate

Call `deploy-gate.sh` from your deploy script before the build step. It runs the mechanical clean on your content directory (default `content`, override with `WMC_CONTENT_DIR`) and fails only when `wmc` is missing.

## Why the defaults run with --no-voice

If your project already has a voice or prose linter, let that tool own stylistic blocking and let WMC Cleaner own the mechanical clean. Turn the voice layer on in a gate only where you want WMC Cleaner to be the enforcer.
