# Plan: Visual dependency map

Status: proposed. Planning and backlog only; no implementation in this PR.

Release proposal: **0.8.4 — Dependency planning**, following the proposed delivery analytics releases. This adds an internal, read-only Dependencies tab backed by the existing `dependsOn` relationships, rather than a second dependency system.

1. [Derive readiness and dependency risks](#1-derive-readiness-and-dependency-risks) (ESM-139)
2. [Explore dependencies as a graph](#2-explore-dependencies-as-a-graph) (ESM-140)
3. [Focus on a release or story](#3-focus-on-a-release-or-story) (ESM-141)
4. [Suggest delivery order and surface risks](#4-suggest-delivery-order-and-surface-risks) (ESM-142)

No new story-point estimates are proposed: the team must agree them. No customer-facing copy is approved. Review release placement before implementation.

## Why and customer outcome

The Solo Builder needs to see what is ready to build, which prerequisites must land first, and a sensible sequence for parallel agent work without opening every story or maintaining a second planner. The PM inheriting a project needs to inspect the prerequisite chain behind an existing commitment, including dependencies that span releases. A coding agent needs a compact, deterministic prerequisite summary and must not invent relationships.

Success: an internal viewer can pick a release or story, identify the explicit dependency chain and actual unfinished prerequisites, and open the existing story panel for evidence and context. A disconnected or large map stays legible.

The YAML file remains the source of truth. Existing `dependsOn` edges, reverse `dependents`, CLI edit commands and validator already cover authoring and cycles. Visualise and derive from them; do not duplicate storage.

## Product decisions

- **Navigation:** a Dependencies tab beside the existing map-related tabs, internal viewers only. Default to the current/next active release when determinable, otherwise a release chooser. Start with a bounded graph, not the entire map.
- **Graph:** left-to-right layout; edges point from prerequisite to dependent. Show ID, abbreviated title and existing delivery status on nodes. Select a node to open the existing detail panel. Pan, zoom, fit-to-view, accessible focus and a textual list alternative.
- **Readiness:** `ready` applies to planned work whose *recorded* prerequisites are all `merged` or `shipped` (or none). `waiting` means one or more unfinished prerequisites; `at risk` means a prerequisite is cut or its release sits later. These are advisory derived states, not new persisted story statuses. A blocked story or one already in progress is not labelled ready to start. Missing links are unknown, not proof of independence.
- **Scope:** release focus includes external prerequisite nodes, clearly marked. Story focus supports direct neighbours and optionally upstream/downstream transitive closure. Preserve selected release/story and filters in shareable links.
- **Ordering:** deterministic topological order for selected work, with explicit upstream prerequisites. Where several orders are possible, do not pretend that one is the product priority. No critical-path duration or completion-date prediction from story points.
- **Permissions:** never send internal dependency graphs or derived metrics to customer viewers, including JSON or client-side payloads. No browser dependency edits in this release; existing CLI/PR workflow persists.
- **Size and performance:** cap initial visible nodes and expand on demand. Derive a compact graph before layout; benchmark realistic sparse and dense maps. Use an established directed layout algorithm only if necessary (evaluate Dagre/ELK), with no unnecessary full graph editor.
- **Error states:** empty maps, no recorded edges, filtered-out nodes, cross-release prerequisites, cut dependencies and stale bookmarks must be intelligible.

## 1. Derive readiness and dependency risks

**Story:** ESM-139 · activity `track` · jobs `triage-backlog`, `plan-and-build`, `pick-up-work`.

Build a pure graph projection from the validated map that returns edges, reverse edges, direct/transitive prerequisites, readiness and issues per story. Keep the output reusable by React and CLI/agent consumers; do not change the YAML schema.

**Acceptance:**
- Edges use stable story IDs; one source of truth is `dependsOn`.
- Planned stories with all prerequisites merged/shipped are ready; unmet dependencies are waiting. Cut dependencies and prerequisites in later releases are flagged separately, without overwriting the story's status.
- Expose the actual blocking IDs and whether each is within the selected release.
- Preserve unknown/missing dependency information as uncertainty; no invented edges.
- Unit tests cover chains, fan-in/out, independent stories, cross-release, blocked/cut/merged/shipped and deterministic ordering.

## 2. Explore dependencies as a graph

**Story:** ESM-140 · depends on ESM-139 · activity `explore` · jobs `triage-backlog`, `plan-and-build`.

Expose a read-only internal Dependencies tab. Render the graph left-to-right, arrows from prerequisites to dependent work, concise node labels, status/readiness differentiation, and a clear empty state.

**Acceptance:**
- Nodes open the existing story detail panel and keep existing story/source links intact.
- Pan/zoom/fit controls, responsive layout, keyboard-accessible nodes and readable text/list fallback.
- No default all-stories hairball; view is scoped and discloses omitted nodes.
- No mutation API or persistence; no dependency data is supplied to customer viewers.
- UI tests use `ESM-140:` prefixes and cover interaction, no edges, accessibility and permission boundaries.

## 3. Focus on a release or story

**Story:** ESM-141 · depends on ESM-140 · activity `explore` · jobs `agree-first-release-plan`, `triage-backlog`.

Allow the viewer to select a release or focus on a story. Keep necessary outside-release prerequisites visible, distinguished from in-scope work. Direct neighbours are default for story focus, with an explicit full-chain option.

**Acceptance:**
- Release/story selection, direct/full-chain toggle, and useful status filters.
- External prerequisites remain visible and labelled; never silently imply all prerequisites are inside the release.
- A URL restores the selection and uses existing permalink conventions.
- Large dependency sets have visible truncation/expansion, without silently hiding a blocking edge.
- Tests cover deep chains, filters, missing/obsolete selection and mixed release memberships.

## 4. Suggest delivery order and surface risks

**Story:** ESM-142 · depends on ESM-139 and ESM-141 · activity `track` · jobs `plan-and-build`, `agree-first-release-plan`, `pick-up-work`.

Present the ready set and a deterministic, valid topological order for selected planned work, plus relevant unfinished prerequisites and release-order risks. Reuse the data in compact agent briefs in a future integration instead of adding a new prompt workflow here.

**Acceptance:**
- Order respects all recorded dependencies, including external prerequisites.
- Concurrently available stories appear as alternatives, not a false mandatory ranking.
- Highlight unfinished, cut and later-release prerequisites with direct links to their stories.
- Explain that readiness is dependency-only, not priority, claim ownership or implementation approval.
- Accessible summary can be copied/read without a graphical UI; no guessed dates or critical-path forecasts.

## Delivery sequence and review checkpoints

**MVP:** ESM-139 then ESM-140. This supplies a usable release-scoped graph and accurate prerequisite states.

**Usability:** ESM-141 adds targeted exploration and makes larger maps practical.

**Planning intelligence:** ESM-142 adds ordered delivery guidance and machine-readable context, without requiring historical analytics or sprint administration.

A plan-only PR updates `docs/plans/visual-dependency-map.md` and `product/story-map.yaml`. Implementation should use focused PRs per story, include the story IDs in test names and commit messages, and run `npm run validate`, relevant tests, `story-map diff origin/main` and source validation.

## Draft release impact

- **Time to identify the unfinished prerequisites for a chosen story:** expected one focused visual review rather than opening each related story in turn; solves opaque build order.
- **Time to find a feasible sequence for a release:** expected a dependency-based ready set and ordering without manually tracing links; solves repeated sequencing work.
- **Release-order dependency conflicts surfaced before implementation:** expected visible warnings for dependencies on later releases or cut stories; solves hidden planning conflicts.

All three are hypotheses awaiting human review (`draft: true` in the map). No baseline or actual improvement is claimed.

## Open review decisions

1. Confirm 0.8.4 release placement relative to the proposed analytics work; the graph has no technical dependency on analytics.
2. Confirm whether an in-progress story with unmet prerequisites should appear only as a warning (proposed), never a new automatic `blocked` status.
3. Choose and benchmark the layout library during ESM-140 rather than committing to it in this planning PR.
