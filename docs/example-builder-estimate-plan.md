# Builder estimate delivery plan example

The sample release sequence delivers the builder workflow first, then updates the finance workflow. The stories it refers to are in the sample map at [`test/fixtures/builder-estimates.yaml`](../test/fixtures/builder-estimates.yaml), which the tests use.

## Builder workflow

- **BUILDER-101** lets a builder draft an estimate against a project. Confirm quantities and units can be entered and saved.
- **BUILDER-102** lets a builder find a material price while preparing an estimate. Confirm what price the submitted estimate records when the catalogue changes.
- **BUILDER-103** sends the completed estimate for approval. Confirm it appears in the finance review queue.

## Finance follow-up

- **FINANCE-201** lets finance approve the estimate and create the purchase order. Confirm the order references the approved estimate.

Track the release assignments and delivery status in [the story map](../product/story-map.yaml).
