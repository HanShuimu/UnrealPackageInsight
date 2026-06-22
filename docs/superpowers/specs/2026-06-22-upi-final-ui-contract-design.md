# UPI Final UI Contract Design

## Context

The desktop renderer was recently moved closer to the Penpot UPI Final visual direction, but several behaviors still come from generic data rendering rather than the design contract. This causes visible product mismatches:

- Deep package directory hierarchies can make supported files hard to read in `Opened containers`.
- Analysis can land on `Issues` even when the useful entry point should be `Overview`.
- Analysis tabs can expose design-external views such as `Blocks`, `Chunks`, `Partitions`, or `Raw`.
- `Overview` and `Packages` are rendered from arbitrary backend fields rather than UPI Final layouts.
- Placeholder regions from the design can appear as real UI.
- `Package Path` values are truncated even when they are already the shortest package paths.

The renderer should treat UPI Final as a UI contract. Backend result fields remain useful data sources, but they must not directly create tabs, columns, or placeholder UI.

## Goals

- Make UPI Final the explicit renderer contract for the analysis workspace.
- Render only the top-level tabs present in UPI Final: `Overview`, `Packages`, and `Issues`.
- Default every completed analysis to the `Overview` tab.
- Keep `Issues` available but never auto-select it solely because issues exist.
- Render `Overview` as real summary statistic cards only.
- Render `Packages` with both `Table` and `Tree` modes, defaulting to `Table`.
- Default package table sorting to package file name.
- Allow package table sorting by size and compressed size.
- Allow package table sorting by physical order when backend order data is available.
- Make the visible `Full Path` table column the fixed leftmost primary table column.
- Display package paths as complete single-line text with no ellipsis and no wrapping.
- Use horizontal table scrolling for columns that do not fit.
- Keep `Details` empty except for its title until the user selects a real package or issue row.
- Make `Opened containers` initially adaptive and draggable so deep hierarchies are easier to read.
- Keep dragged `Opened containers` width in current renderer state only, with no local persistence.
- Remove design placeholders from the production UI.

## Non-Goals

- No native backend behavior changes.
- No protocol or generated backend manifest changes.
- No persistent user settings for pane widths.
- No new top-level analysis tabs outside UPI Final.
- No display of compressed block, chunk, partition, or raw response data as separate UI pages.
- No chart implementation for `Size breakdown`; it is treated as a placeholder for now.
- No placeholder cards in `Details`.

## UI Contract

The analysis workspace always exposes the same top-level tabs:

- `Overview`
- `Packages`
- `Issues`

No backend field is allowed to create an additional top-level tab. If future design work adds a tab, that tab must be added to the contract deliberately.

`Overview` contains only statistic cards backed by real data. The initial card set is:

- Package count, when package count data is available.
- Total size, derived from overview or package rows when available.
- Compressed size, derived from package rows when available.
- Issue count, derived from `issues`.

Missing values do not produce placeholder cards.

`Packages` contains a view switch with:

- `Table`
- `Tree`

The `Table` view is active by default. Rows are normalized from Pak and IoStore package entries into a common package row model. The default sort is by package file name, using the basename of the package path. Size and compressed size are sortable through table headers.

The primary path column:

- Uses the visible header `Full Path` to match UPI Final.
- Is populated from backend package path data such as `packagePath`.
- Is fixed to the left.
- Uses complete single-line text.
- Does not use ellipsis.
- Does not wrap.
- Remains visible while horizontally scrolling other columns.

Other package table columns are narrow and design-approved. They include size, compressed size, type, and physical order when real data is available. They must not crowd out the primary path column.

The `Tree` view builds a hierarchy from package paths. It is a package-content tree, not a duplicate of the opened filesystem tree.

`Issues` renders only design-approved issue fields. An empty issues list shows a simple empty state inside the tab, but the app remains on `Overview` after analysis.

## Opened Containers Pane

The `Opened containers` pane remains a filesystem hierarchy of supported container files. It must be usable for deep paths under directories such as `C:\WORKSPACE_RA\RATrunk\LocalBuilds\Game\Windows`.

Initial width is adaptive:

- Start from the UPI Final default width.
- Estimate an expanded width from visible tree depth and longest supported file label.
- Clamp the width so the center workspace and right details pane remain usable.

The pane has a draggable right boundary:

- Dragging changes the pane width for the current renderer session.
- Width is not stored in local storage or configuration.
- The pane has a minimum width that keeps controls usable.
- The pane has a maximum width that leaves meaningful space for analysis content.

Tree node labels should avoid unnecessary truncation. If truncation is still unavoidable at the current width, the full path can be available via title or tooltip, but tooltip access is not the primary solution.

## Details Pane

When nothing is selected, the details pane displays only:

- The title `Details`.

It does not display placeholder cards, empty framed regions, or explanatory placeholder copy.

Selecting a package row or package tree item shows real package details. Selecting an issue row shows real issue details. Details content is derived from the selected view model item rather than from arbitrary backend fields.

## State And Data Flow

The renderer introduces explicit UPI Final view-model helpers:

- `buildAnalysisViewModel(result)` returns a stable model for the three allowed tabs.
- `buildOverviewCards(result)` returns only real overview cards.
- `buildPackageRows(result)` normalizes Pak and IoStore package data.
- `buildPackageTree(rows)` builds the package path hierarchy for the `Tree` view.
- `buildIssueRows(result)` returns design-approved issue rows.

When `analysisResult` changes:

- Active top-level tab resets to `Overview`.
- Package view mode resets to `Table`.
- Package sorting resets to file name.
- Details selection clears.

The existing async store flow stays intact: opening a directory scans supported containers, selecting a container triggers analysis, AES retry and backend selection dialogs keep their current behavior.

## Testing

Implementation should follow test-first changes. The regression suite should cover:

- `buildAnalysisTabs` or its replacement always returns only `overview`, `packages`, and `issues`.
- Analysis result changes reset active tab to `Overview`.
- No placeholder copy such as `Tab content region` or `Replace with Pak or IoStore tab variants` appears in production rendering.
- `Overview` renders only available statistic cards.
- `Packages Table` defaults to file-name sorting.
- Size and compressed size sorting are available.
- Physical order sorting is available when package order data exists.
- `Full Path` is fixed left, populated from package path data, single-line, not ellipsized, and horizontally scrollable.
- `Packages Tree` renders hierarchy from package paths.
- `Opened containers` computes an adaptive initial width and supports drag resizing without persistence.
- Empty `Details` renders only the title.
- Selecting a package or issue populates Details with real data.

GUI verification must include a fresh Electron smoke test through DevTools Protocol:

- Renderer has no runtime exceptions.
- `#root` has mounted content.
- Expected UI text is visible.
- `window.upi` is available.
- The packages table has the fixed path column behavior.
- The opened containers pane can be resized.
