# Extract Status And Package Offset Design

Date: 2026-06-23

## Goal

Improve two confusing parts of the current Pak and IoStore analysis workflow:

- Extraction should show an obvious in-progress modal after the user chooses an output directory, and the modal should disappear when extraction finishes.
- The Packages tab should show the package's real physical offset instead of the current `Order` value.

This is an incremental improvement to the existing container extraction feature. It does not change native extraction behavior or add custom Pak or IoStore path rules.

## Current Behavior

The renderer already tracks extraction with `isExtracting` and `statusText`. While extraction runs, the toolbar status changes to `Extracting...`, the analysis region spinner appears, and the `Extract to...` button shows a loading state.

That feedback is easy to miss because the user's focus remains inside the Packages tab. A modal gives the action a stronger and more local acknowledgement.

The Packages table currently displays a column titled `Order`. This value is not a byte address. It is a zero-based physical ordering index calculated by the native analyzer.

For Pak analysis, the backend reads package entries, sorts them by `FPakEntry.Offset`, breaks ties by package path, then assigns `Order` from the sorted index.

For IoStore analysis, the backend sorts chunks by partition, on-disk offset, and TOC entry index. Package rows are then aggregated from those sorted chunks, and package `Order` is the aggregate row index. The package's first physical location is represented by `firstOffset`.

## User Experience

After clicking `Extract to...` and selecting a target directory, the renderer opens an extraction modal.

The modal shows:

- title: `Extracting`
- an indeterminate spinner
- the selected container path
- the output directory
- concise text such as `Extracting files...`

The modal closes automatically when extraction finishes, fails, or becomes stale because the user starts a new analysis/open-directory flow. If the user cancels the output directory picker, the modal never opens.

After the modal closes:

- success keeps the existing `Extract complete` status
- failure keeps the existing `Extract failed` status and issue result behavior

If the user cancels the output directory picker, the toolbar status keeps the existing `Extract canceled` behavior.

The first version should not show a percentage progress bar. Current extraction is a single native worker request: the renderer can observe start and completion, but it does not receive per-file or per-byte progress events. Showing a percentage would be synthetic and could mislead users.

## Packages Offset Display

Replace the Packages table `Order` column with an `Offset` column.

For Pak package rows:

- source field: `offset`
- meaning: package record physical offset in the `.pak`

For IoStore package rows:

- source field: `firstOffset`
- meaning: first on-disk offset among the package-backed chunks in the `.ucas` stream

The renderer view model should normalize both into a single package row field, for example `physicalOffset`.

The table should render offsets as fixed-width hexadecimal strings, for example `0x000000001234ABCD`. Missing offsets render as blank.

The Details pane should also replace the `Order` detail with `Offset`, using the same normalized field and formatting.

Sorting the `Offset` column should sort numerically by `physicalOffset`, with known values before unknown values. The default table ordering can remain by file name unless the user clicks the column sorter.

## Data Flow

Native analysis already emits the needed fields:

- Pak `PakPackageEntry.offset`
- IoStore `IoStorePackageEntry.first_offset`

The JavaScript protocol decoders already expose these as:

- Pak `package.offset`
- IoStore `package.firstOffset`

The renderer view model should prefer physical offsets in this order:

1. `offset`
2. `physicalOffset`
3. `physical_offset`
4. `firstOffset`
5. `first_offset`

The existing `order` field can remain in the decoded source object for compatibility, but the Packages table should stop presenting it as the primary physical-location column.

Extraction should move to a two-stage renderer IPC flow:

1. Ask Electron main to show the output directory picker.
2. If the picker returns a directory, set `isExtracting`, set the extraction modal context, and call Electron main to extract the selected container to that exact directory.

This keeps the modal out of the native directory picker flow and lets the modal show both the selected container path and the output directory while extraction is actually running.

## Components

Update these GUI-layer units:

- `analysisViewModel`: add `physicalOffset`, preserve current package identity and duplicate handling.
- `PackageTable`: rename the column to `Offset`, render hexadecimal offsets, and sort by `physicalOffset`.
- `DetailsPane`: show `Offset` instead of `Order`.
- `appStore`: store enough extraction context to let the UI show container path and output directory in the modal.
- Electron IPC/preload: split output directory selection from extraction.
- `App`: render an Ant Design modal tied to `isExtracting` and the extraction context.

Prefer keeping the modal state in the renderer store because the store already owns extraction lifecycle, stale request guards, and status text.

## Error Handling

The modal should not remain visible in any terminal extraction path:

- extraction success
- structured backend error result
- unexpected exception
- stale extraction ignored because analysis context changed

Directory picker cancel happens before extraction begins, so it should leave the modal closed and set the existing `Extract canceled` status.

The modal should open after the directory picker resolves and before the worker extraction starts. It should not appear while the native directory picker is open.

Unexpected renderer exceptions should continue to become `renderer.extract_failed` issue results through the existing store behavior.

## Testing

Add or update renderer regression tests for:

- Output directory cancel does not open the extraction modal.
- Extract modal opens while `isExtracting` is true with a known container and output directory.
- Extract modal closes after success, failure, and stale request completion.
- Package rows normalize Pak `offset` and IoStore `firstOffset` into `physicalOffset`.
- Package table column contract uses `Offset`, not `Order`.
- Offset values render as hexadecimal strings and sort numerically.
- Details pane shows `Offset`.

Because this is a GUI change, run a fresh Electron GUI smoke test before finishing implementation. The smoke should still verify no renderer exceptions, mounted `#root`, expected visible UI text, and `window.upi`; it should also verify the Packages table no longer exposes `Order` as the physical-location column when sample data is present if the existing smoke harness can provide such data.

## Out Of Scope

- Real percentage progress during extraction.
- Per-file extraction progress events.
- Native extraction protocol changes.
- Custom Pak mount point or IoStore extraction path behavior.
- Removing `order` from protocol schemas or native analysis records.
