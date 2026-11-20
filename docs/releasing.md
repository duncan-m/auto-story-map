# Releasing

Releases are published to npm by [the release workflow](../.github/workflows/release.yml) when a version tag is pushed. The workflow runs the full test matrix, publishes with provenance, and creates a GitHub release from the matching [changelog](../CHANGELOG.md) section.

## Set up publishing once

npm can only trust a workflow for a package that already exists, so publish the first version from a maintainer’s machine.

1. Check out the release commit on `main`, then run `npm ci`, `npm test` and `npm publish --access public`. npm asks you to sign in and confirm with two-factor authentication.
2. In the package’s settings on npmjs.com, add a trusted publisher for GitHub Actions with these values:
   - Organization or user: `duncan-m`
   - Repository: `embedable-story-map`
   - Workflow filename: `release.yml`
   - Environment: `npm`
3. Push the version tag as described in step 5 below. The workflow sees that the version is already on npm, skips publishing and creates the GitHub release.

Later releases authenticate through the workflow’s OpenID Connect token, so the repository holds no npm token. The publish job runs in a GitHub environment called `npm`. To require approval before each publish, add required reviewers to that environment in the repository settings.

## Release a version

1. On a branch, set the new version with `npm version <version> --no-git-tag-version`. Before 1.0.0, use a minor version for breaking changes and a patch version for fixes.
2. Add a `## <version>` section to `CHANGELOG.md`, or rename the `## Unreleased` section. The board's version footer links to this heading, and a test checks that it exists. Mark breaking changes and link to the upgrade steps.
3. For breaking changes, add an upgrade section to `docs/story-map.md` and update the upgrade links in `README.md` and `AGENTS.md`.
4. Merge the PR into `main`.
5. Tag the merge commit and push the tag:

   ```sh
   git tag v<version>
   git push origin v<version>
   ```

The workflow stops before publishing if the tag does not match `package.json` or the changelog has no section for the version.

## If the repository is renamed

GitHub redirects the old URLs, but update these to match the new name: `repository`, `homepage` and `bugs` in `package.json`, the `$id` in `scripts/build-schema.mjs` (then rebuild and commit `story-map.schema.json`), the links in `README.md` and `CHANGELOG.md`, `sourceBaseUrl` in `example/demo.mjs`, and the repository in the npm trusted publisher settings.
