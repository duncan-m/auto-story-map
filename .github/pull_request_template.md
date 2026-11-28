<!--
Title: say what the PR changes, starting with the story ID when there is one,
such as "ESM-601: Limit author names in the history file".
-->

## What changes

<!-- What this PR does and why, in a few sentences. Link the plan section. -->

Architecture: <!-- For work with no plan, following docs/ENGINEERING-OVERVIEW.md#record-architecture-decisions: "None: keeps the existing design because …" with a real reason, or the decision with each affected consumer, the alternative considered, who agreed it and what would justify revisiting it. For work with a plan, "See the plan's Architecture decisions section". -->

## Stories

<!-- Story IDs this PR delivers or changes, such as ESM-601. Flag any planned or in-progress story without an estimate, and any unclear release or status. -->

## Story map changes

<!-- Paste the summary from: npx story-map diff origin/main. If you could not run it, say so and keep the PR as a draft. For each item under Needs a person, say which person made or agreed it. -->

## Customer-facing changes

<!-- Anything customers will see, or "None". -->

## Tokens used

<!-- In the PR that finishes a story, paste the output of: npx story-map tokens --format markdown <ID>, and record it with story-map edit <ID> --tokens <n> --estimated-cost <usd>. Otherwise say why there is no count, or "Not the final PR". -->

## Tests

<!-- What you ran, such as npm run validate and npm test. -->

## Review

<!-- Record the review of this diff before marking the PR ready, following docs/ENGINEERING-OVERVIEW.md#review-a-code-change. A person's review of the same diff also counts. If no review could be run, say so and keep the PR as a draft. -->

- Target: <!-- such as /code-review 190, or origin/main...HEAD before the PR existed -->
- Commit reviewed: <!-- the SHA at HEAD when the review ran -->
- Level: <!-- such as medium, or "person" for a person's review -->
- Findings fixed: <!-- each finding and the commit that fixed it, or "None" -->
- Findings declined: <!-- each finding and why it was not fixed, or "None" -->
- Review cost: <!-- the review's own tokens and cost, apart from the story's: note the time before the review, then replace this whole line with the output of npx story-map tokens --format markdown --since <time> <ID>, which starts with "- Review cost:". Or say why there is no count -->
