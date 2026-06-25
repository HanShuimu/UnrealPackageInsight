# Packages CSV Export Design

Date: 2026-06-25

## Goal

Add a Packages tab action that exports the current Table-mode package list to a CSV file. The CSV is intended for quick text and spreadsheet comparison between two analyzed containers.

The feature exports the same logical list shown by the Packages Table. It does not expose native backend protocol internals, does not add new native backend exports, and does not change protocol schemas.

## User Experience

The Packages tab toolbar gains an `Export CSV...` button beside the existing `Extract to...` button.

The button is enabled only when all of these are true:

- the Packages tab is in Table mode,
- a selected container and analysis result exist,
- the current Table has at least one package row,
- no analysis, extraction, or CSV export action is currently running.

Tree mode keeps the button visible but disabled. Tree mode is a browsing view, and this first version does not export tree hierarchy.

Clicking `Export CSV...` opens an Electron native Save dialog. The default filename is:

```text
<container-basename>.packages.csv
```

Examples:

```text
pakchunk0-Windows.pak.packages.csv
global.utoc.packages.csv
```

The Save dialog uses a CSV file filter. If the user enters a filename without a `.csv` extension, the app appends `.csv`. Existing `.csv` extensions are accepted case-insensitively and are not duplicated. If the destination exists, overwrite confirmation is left to the OS dialog.

If the user cancels the Save dialog, no file is written, no modal is shown, and the status text becomes `CSV export canceled`.

While export runs, the app uses the existing busy/loading presentation: the analysis region spinner appears and the export action is disabled against duplicate starts.

On success, the app shows a modal dialog titled `CSV exported`. The dialog includes the saved file path and exported package row count, for example:

```text
D:\Exports\global.utoc.packages.csv
1234 packages exported.
```

On failure, the app shows a modal dialog titled `CSV export failed` with the error message and updates the status text to `CSV export failed`.

CSV export errors do not write to the Issues tab. The Issues tab remains reserved for backend analysis issues returned by the native backend.

## CSV Contract

The CSV includes a header row.

Columns strictly follow the current Packages Table definition:

- same column set,
- same column order,
- same header titles,
- same row source as the Table.

For the current table, that means headers such as:

```text
Full Path,Size,Compressed,Order
```

If a later feature renames or replaces `Order` with `Offset`, the CSV follows the Table column definition automatically.

Cell values use raw stable values rather than formatted screen strings. For example, `Size` exports `2048` instead of `2.00 KB`. Blank table values export as empty CSV fields.

CSV encoding and formatting:

- UTF-8 with BOM,
- comma-delimited fields,
- standard CSV escaping,
- fields containing commas, quotes, CR, or LF are wrapped in double quotes,
- quotes inside fields are doubled,
- rows end with CRLF.

The CSV does not include metadata comments such as export time, container path, tool version, or selected row state. This avoids introducing noisy diffs.

## Row Ordering

The exported rows cover the entire current Packages Table dataset, not just the visible virtual-scroll viewport.

Row order must match the Packages Table order at the moment the user clicks `Export CSV...`.

The current Table default ordering should continue to follow existing physical-address sorting behavior. This design does not introduce new physical-address fallback rules. If the user changes the Table sort order, the CSV export uses that visible Table order.

Sorting state is not persisted across analysis files or app sessions. Reanalyzing or selecting another container resets to the Table default.

Selected package row, Details pane state, and Tree expansion state are not exported.

If a defensive race produces an export request with zero rows, the app does not write an empty CSV and instead reports `No packages to export.`

## Architecture

Use a shared pure JavaScript Packages table/export module so the future CLI can reuse the same logic.

The shared module owns:

- package row normalization from an analysis result,
- package row default ordering,
- Packages Table column schema,
- mapping a Table sort state to ordered rows,
- raw export value selection for each column,
- CSV serialization.

The renderer owns:

- React Table rendering,
- Table mode state,
- current sort state,
- export button state,
- export lifecycle state,
- success and failure modal presentation.

Electron main owns:

- Save dialog presentation,
- `.csv` extension normalization,
- writing the CSV bytes to disk.

The native backend and FlatBuffer protocol remain unchanged.

## Future CLI Reuse

This change does not add a CLI CSV command.

The shared export module should make a future CLI command straightforward. A later command can analyze a container, pass the analysis result through the same Packages table/export module, and write the returned CSV bytes to a user-specified path.

That future CLI work should not need to duplicate Packages row normalization, column selection, default ordering, or CSV escaping.

## Data Flow

Renderer flow:

1. Build the Packages table model from the current analysis result through the shared module.
2. Track current Table sort state.
3. Enable `Export CSV...` only in Table mode with non-empty rows.
4. On click, request a save path through preload/Electron main.
5. If canceled, set `CSV export canceled`.
6. If a path is returned, generate CSV bytes from the current table rows and sort state.
7. Send the bytes and target path to Electron main for writing.
8. Show success or failure modal and update status text.

Electron main flow:

1. Show Save dialog with the default `<container-basename>.packages.csv` filename.
2. Return `null` for cancel.
3. Normalize the selected path to a `.csv` extension.
4. Write the provided bytes to the selected file.
5. Return a small result with file path and byte count or throw a readable error.

## Error Handling

Expected GUI-layer failures:

- Save dialog canceled,
- no selected container,
- no packages to export,
- invalid or missing save path,
- filesystem write failure,
- unexpected CSV serialization failure.

Cancel is not an error and does not show a modal.

Failures show a modal and set a concise status text. They do not mutate `analysisResult` and do not add Issues tab entries.

## Testing

Add focused automated tests for:

- shared CSV serialization, including BOM, CRLF, quotes, commas, and blank values,
- shared Packages column schema export values,
- export row order matching Table default order and user sort state,
- `Export CSV...` enabled in Table mode and disabled in Tree mode,
- disabled export when there are no package rows,
- Save dialog cancel leaving no modal and setting canceled status,
- successful export calling Electron write with `.csv` normalization and showing row count/path modal,
- failed export showing a failure modal without changing Issues data,
- future CLI-facing shared module behavior without importing React.

Because this is a GUI change under `node-shell/apps/desktop/**`, final implementation must run a fresh Electron GUI smoke test. The smoke must launch the app, inspect the renderer through DevTools Protocol, and verify:

- no renderer runtime exceptions,
- `#root` has mounted content,
- expected visible UI text includes `Overview`, `Packages`, `Issues`, `Opened containers`, `Details`, and `Export CSV...`,
- the preload API is available as `window.upi`.

## Out Of Scope

- Exporting Tree-mode hierarchy.
- Exporting only selected package rows.
- Adding package export metadata rows.
- Adding a CLI CSV command in this change.
- Changing native backend behavior.
- Changing FlatBuffer protocol schemas.
- Writing GUI export errors into the Issues tab.
