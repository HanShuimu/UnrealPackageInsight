# Penpot UI Requirements Workflow

Use this workflow when turning a Penpot design board into an implementable UI
requirements plan, especially when parts of the design are placeholders, have
business logic, depend on data, or need explicit implementation constraints.

This workflow creates a design contract. It does not by itself authorize code
changes unless the user also asked for implementation.

## Research Basis

- Penpot MCP can expose pages, layers, components, styles, tokens, and layout
  metadata to agents, and agents should begin with read-only inspection before
  writing design changes: https://help.penpot.app/mcp/
- Penpot components support annotations that are visible on component copies and
  in Inspect, making them suitable for reusable component specs:
  https://help.penpot.app/user-guide/design-systems/components/
- Penpot comments are for feedback directly over designs and prototypes:
  https://help.penpot.app/user-guide/account-teams/comments/
- Penpot variants express component state, size, and style axes that can map to
  code props: https://help.penpot.app/user-guide/design-systems/variants/
- Penpot design tokens follow the DTCG format and should be treated as the
  visual source of truth: https://help.penpot.app/user-guide/design-systems/design-tokens/
- Penpot Flex and Grid layouts map to CSS layout concepts and should be
  preferred over inferred absolute positioning when present:
  https://help.penpot.app/user-guide/designing/flexible-layouts/
- Penpot Inspect exposes measurements, properties, CSS, markup, and export
  information for handoff: https://help.penpot.app/user-guide/dev-tools/
- Penpot prototypes express navigation, overlays, URL actions, delays, and flow
  starts: https://help.penpot.app/user-guide/prototyping-testing/prototyping/
- This repository already documents local Penpot MCP startup in
  `docs/tools/penpot-mcp.md`.

## Required Inputs

Get as many of these inputs as are available. Do not invent missing inputs.

- Penpot file/page/board name or a share link.
- The feature or screen being implemented.
- Target framework and styling approach, if implementation is in scope.
- Existing repository UI conventions and design specs.
- Explicit user notes about placeholders, business rules, data sources,
  permissions, loading states, error states, accessibility, or non-goals.

If the Penpot MCP connection is unavailable, continue with screenshots, exported
assets, share links, and user-provided notes. Mark evidence strength as
`visual-only` for anything not verified through MCP or Inspect.

## Setup

1. Work in an isolated git worktree when making repository changes.
2. Read repository instructions and existing design specs before writing.
3. If Penpot MCP is needed locally, use repository npm scripts:

   ```powershell
   npm.cmd run penpot:mcp:start
   npm.cmd run penpot:mcp:status
   ```

4. In Penpot, open the target design file, load
   `http://localhost:4400/manifest.json`, and click `Connect to MCP server`.
5. Keep the Penpot plugin UI open while inspecting the design.

Do not add workflow configuration through environment variables. If a workflow
value must be configurable, put it in an explicit command argument or a checked
configuration file.

## Inspection Order

Inspect in this order so the design contract is grounded before details are
filled in.

1. Pages and boards: identify the functional area and flow.
2. Tokens and styles: list color, typography, spacing, radius, shadow, and
   sizing tokens that the target board actually uses.
3. Components and variants: identify reusable components, state axes, and
   component annotations.
4. Layout: record whether containers use Flex, Grid, or fixed/absolute layout.
5. Prototype interactions: record trigger, action, destination, overlay behavior,
   animation, and flow start.
6. Comments and annotations: collect only actionable notes.
7. Inspect output: collect measurements, CSS, markup, and asset exports needed
   for implementation.
8. Repository mapping: map design components to existing code components,
   utilities, tests, and constraints.

With MCP, prefer read-only calls first:

```text
List pages in this file.
Show all components on this page.
Analyze the structure of this design and summarize it.
List the color styles and tokens used by this board.
```

If writing to Penpot is requested, describe the intended edits before applying
them and keep them small and reversible.

## Annotation Taxonomy

Use stable labels in Penpot comments, component annotations, layer names, and
the external design contract. The external contract is authoritative for logic.

```text
[PLACEHOLDER] Visual or product placeholder.
[LOGIC] Conditional behavior, permission rule, or business rule.
[DATA] Data binding, API field, or derived value.
[STATE] Loading, empty, error, disabled, selected, hover, focus, or active state.
[INTERACTION] Click, hover, overlay, navigation, drag, keyboard, or delay behavior.
[A11Y] Accessibility requirement.
[ASSET] Exported icon, image, or media requirement.
[QUESTION] Decision needed before implementation.
[NON-GOAL] Design detail intentionally out of scope.
```

Use three placeholder subtypes:

```text
placeholder.visual
Only supports composition. Remove or replace during implementation.

placeholder.data
The UI is real, but it must bind to real data before shipping.

placeholder.product
The product behavior is undecided. Do not implement by guessing.
```

Example Penpot comment:

```text
[PLACEHOLDER] placeholder.data
id: UI-REQ-014
target: Dashboard.SizeBreakdown
meaning: Chart shape is visual only.
implementation: Bind to package size categories when backend data exists.
fallback: Omit the chart if no real category data exists.
```

Example layer name when a comment is not enough:

```text
@placeholder.data/Dashboard.SizeBreakdown
@logic/ProjectRow.ArchivedActions
@state/Button.Primary.Loading
```

Do not add decorative text layers solely to explain annotations. Use comments,
component annotations, layer names, and the external contract instead.

## Design Contract Output

Write the contract in the repository, usually under `docs/superpowers/specs/`
when it is part of an implementation plan. Use a concise, stable format that
another agent can execute without reinterpreting the design.

Minimum sections:

- Context
- Design sources and evidence strength
- Goals
- Non-goals
- Boards and flows
- Tokens and layout rules
- Components and variants
- Placeholder register
- Logic and data rules
- State matrix
- Interaction matrix
- Accessibility requirements
- Asset/export requirements
- Repository implementation mapping
- Testing and verification requirements
- Open questions

Use stable requirement IDs:

```yaml
id: UI-REQ-023
target: ProjectList.Row.Actions
source:
  penpotPage: Dashboard
  penpotBoard: Project List
  layer: Row/Actions
  evidence: mcp-inspected
type: logic
rule:
  if: project.status == "archived" && user.role != "owner"
  then:
    disable: ["Edit", "Archive"]
    show: ["ViewDetails"]
acceptance:
  - Archived projects are not editable by non-owners.
  - Owners can still view details.
```

Every placeholder must have:

- subtype: `placeholder.visual`, `placeholder.data`, or `placeholder.product`
- target
- source
- implementation decision
- fallback
- owner or decision status when known

Every logic or data rule must have:

- condition or source field
- UI effect
- fallback when data is missing
- acceptance criteria

Every state requirement must have:

- stable requirement ID
- target component or region
- state name, such as loading, empty, error, disabled, selected, hover, focus,
  or active
- entry condition
- expected visual and interaction behavior
- fallback when required data or capability is missing
- acceptance criteria

Every interaction requirement must have:

- stable requirement ID
- target trigger element
- trigger, such as click, hover, drag, keyboard, delay, or route change
- action, destination, overlay behavior, or side effect
- disabled/error behavior
- acceptance criteria

## Agent Execution Rules

- Treat Penpot as the visual source of truth, not the sole source of business
  logic.
- Do not let backend fields automatically create tabs, panels, columns, or
  production UI that are not in the design contract.
- Do not implement placeholders as real production UI unless the contract says
  how to replace them with real data or behavior.
- Prefer existing repository components and styling patterns over new
  abstractions.
- Preserve the hierarchy tokens -> components -> layout -> screens.
- Map Penpot variants to code props or states whenever possible.
- Map Penpot tokens to code tokens, CSS variables, or existing theme values.
- When values are missing, record `QUESTION` or omit the UI; do not invent
  colors, spacing, breakpoints, product rules, or copy.
- If a GUI implementation follows from this workflow, obey the repository GUI
  change rules, including renderer regression tests and a fresh Electron GUI
  smoke test through DevTools Protocol.

## Review Gate

Before implementing from the contract, or before claiming the workflow output is
complete, run an independent review. The reviewer must receive the contract file
and this checklist, not the author's reasoning history.

Review checklist:

- The workflow/source contract distinguishes visual design from business logic.
- Placeholders are classified and cannot accidentally ship as real UI.
- Logic, data, state, and interaction requirements have stable IDs and
  acceptance criteria.
- Missing information is marked as `QUESTION`, not guessed.
- Penpot components, annotations, variants, tokens, layout, comments, Inspect,
  and prototypes are each considered where relevant.
- Repository-specific commands and constraints are honored.
- No workflow variable depends on environment variables.
- Verification steps match the files that would change.
- Another agent could execute the contract without needing hidden context.

Address all blocking review feedback, then repeat review until the reviewer
explicitly reports no blocking issues.

## Final Reporting

When finishing a workflow run, report:

- Worktree path and branch.
- Penpot evidence used: MCP, Inspect, comments, screenshot, share link, or
  visual-only.
- Contract file path.
- Placeholder, logic, state, and interaction counts.
- Review result and reviewer feedback summary.
- Verification commands and results.
- Commit hash for repository changes.

Repository changes must be committed before finishing, following `AGENTS.md`.
