# Releasing

How a new version of WMC Cleaner reaches PyPI and npm.

## The short version

A release is triggered by pushing a git tag `vX.Y.Z`. GitHub Actions
(`.github/workflows/release.yml`) then builds and publishes automatically. No
tokens, no local publishing, no passkey prompts.

## Step by step

1. Bump the version in both package files, they must stay in sync:
   - `pyproject.toml` -> `version = "X.Y.Z"`
   - `node/package.json` -> `"version": "X.Y.Z"`
2. Update `CHANGELOG.md`.
3. Commit and push to `main`.
4. Create and push the tag:
   ```
   git tag -a vX.Y.Z -m "wmc-cleaner vX.Y.Z"
   git push origin vX.Y.Z
   ```
5. The `release` workflow runs and publishes.

## What the tag triggers

The `release` workflow has three jobs:

- **pypi**: builds the wheel and publishes to PyPI via trusted publishing
  (OpenID Connect, no token). Live now.
- **github-release**: creates the GitHub release with generated notes. Live now.
- **npm**: publishes the node package via trusted publishing (OpenID Connect,
  no token). Live now.

Both registries publish from the same tag. The npm trusted publisher is
configured on npmjs.com for owner `pixelstrunk`, repository `wmc-cleaner`,
workflow `release.yml`, no environment, action `npm publish`.

## Manual npm publish (fallback)

If you ever need to publish npm by hand, do it in a real terminal so the passkey
prompt works:

```
cd node
npm publish --auth-type=web
```

## Trusted publishing on PyPI

PyPI is already configured as a trusted publisher for this repository. The
`pypi` job uses the `pypi` environment and `id-token: write`. Nothing to do per
release.
