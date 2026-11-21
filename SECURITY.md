# Security policy

## Report a vulnerability

Report vulnerabilities privately through GitHub: [open a draft security advisory](https://github.com/duncan-m/auto-story-map/security/advisories/new). Only the maintainer can see it.

Please do not open a public issue, pull request or discussion for a vulnerability until a fix is released.

Include what you can of:

- the affected version, entry point (library, React board, `board.js` or the `story-map` CLI) and configuration
- steps or a minimal story map that reproduces it
- what an attacker gains, and what they need first, such as write access to the map or a customer login on the host

## What happens next

Auto Story Map has one maintainer, so these are aims rather than guarantees:

- an acknowledgement within 5 working days
- an assessment, and a fix plan or an explanation if it is not treated as a vulnerability, within 14 days
- a fixed release as soon as practical, then a published advisory that credits you unless you ask not to be named

Please keep the report private until the advisory is published, and tell us if you plan to publish your own write-up.

## Supported versions

Only the latest release on npm gets security fixes. The package is pre-1.0, so fixes ship in a new minor or patch release rather than as backports.

## Scope

In scope:

- a customer viewer seeing internal content, such as internal stories, blocked or cut stories and their reasons, internal IDs or status history
- script injection or unsafe links in the board from map text
- the CLI reading or writing outside `--root`, running Git with attacker-controlled options, or being slowed to a stall by a crafted map or Markdown file
- `story-map diff` output that mentions people or links issues when pasted
- the release workflow publishing anything other than the reviewed tag

These boundaries are described in [Security boundaries to preserve](docs/ENGINEERING-OVERVIEW.md#security-boundaries-to-preserve).

Out of scope:

- `example/demo.mjs`, which picks a role from `?as=` and only listens on `127.0.0.1`. It is not an authentication model.
- a host that decides a viewer's role incorrectly or does not send `storyMapResponseHeaders`
- vulnerabilities in dependencies with no exploitable path through this package. Report those upstream, but tell us if this package makes them reachable.
