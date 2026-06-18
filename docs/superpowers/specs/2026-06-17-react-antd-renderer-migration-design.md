# React Ant Design Renderer Migration Design

## Context

The current Electron renderer is a direct HTML/CSS/vanilla JavaScript shell. It works for small package directories, but large directories can overwhelm the left package tree and the same rendering model will also struggle with large analysis result tables from Pak and IoStore containers.

The product direction is to stop solving these as isolated CSS or hand-rolled virtualization problems. The renderer should move to a mature component stack that provides reliable data-dense UI primitives, especially virtualized tree and table controls.

## Goals

- Replace the current renderer implementation with a React and TypeScript renderer bundle.
- Use a mature UI library for common desktop-tool controls instead of custom building each control.
- Fix large directory usability by rendering the package tree with a virtualized tree component and a draggable vertical scrollbar.
- Render large Pak and IoStore analysis tables with virtualized table bodies.
- Keep the Electron main/preload IPC contract stable where possible.
- Preserve current workflows: load backend info, open a directory, select a supported package file, analyze it, handle AES key prompts, and choose a backend when multiple backends match.

## Non-Goals

- No native backend behavior changes.
- No protocol or generated backend manifest changes.
- No full redesign of package analysis semantics.
- No custom virtual scrolling engine in the renderer.
- No initial support for advanced table features such as sorting, filtering, column pinning, or column resizing unless they are needed to preserve existing behavior.

## Stack Decision

The renderer will use:

- React for component structure.
- TypeScript for typed UI state, IPC responses, and analysis result models.
- Ant Design as the primary UI component library.
- Zustand for lightweight renderer state management.
- Rsbuild as the preferred Rspack-powered build layer, with direct Rspack configuration only if Rsbuild cannot fit the Electron renderer constraints.
- Minimal scoped CSS for shell sizing and Electron-specific layout constraints.

Tailwind CSS and shadcn/ui are not the primary choice for this migration. They are good for AI-friendly custom UI composition, but this project needs robust ready-made data controls. shadcn/ui documents itself as an open-code component distribution approach rather than a traditional installed component library, and its data table guidance relies on assembling TanStack Table patterns. Ant Design provides the specific high-value controls this app needs now: Tree with virtual scrolling and Table with virtual list support.

## Architecture

The Electron main process remains responsible for native backend routing, package directory scanning, and analysis IPC handlers. The preload script continues exposing a narrow `window.upi` API to the renderer.

The renderer becomes a built React app:

- `index.html` loads the generated renderer bundle.
- `src/main.tsx` mounts the React app.
- `src/App.tsx` owns the high-level shell layout.
- `src/stores/useAppStore.ts` owns backend status, scan state, selected file, active analysis result, dialogs, and async operation status.
- `src/components/PackageTree.tsx` adapts scan tree data into Ant Design `Tree` data.
- `src/components/AnalysisTabs.tsx` renders result tabs.
- `src/components/AnalysisTable.tsx` adapts arrays of result objects into Ant Design `Table` columns and rows.
- `src/components/AesKeyDialog.tsx` and `src/components/BackendChooserDialog.tsx` replace the current native dialog DOM handling.
- `src/ipc/upiClient.ts` wraps `window.upi` so the rest of the app depends on a typed client instead of the global directly.

## Package Tree

The package tree will use Ant Design `Tree` or `DirectoryTree`. It must set a numeric `height` so Ant Design's virtual scrolling is active. The current scan tree data maps to `treeData` nodes with stable keys based on file paths.

The initial behavior remains fully expanded for directories that contain supported package files, matching the current renderer. Supported files remain selectable; directories are visible as hierarchy nodes. Selecting a file updates the selected file state and starts analysis.

Long paths and file names should be truncated visually with tooltip access to the full path. Because Ant Design documents that virtual tree scrolling does not support auto-width horizontal scrolling, the first implementation will prioritize stable vertical scrolling and text truncation over horizontal tree scrolling.

## Analysis Tables

Analysis arrays such as packages, chunks, compressed blocks, partitions, and issues will render through a reusable `AnalysisTable` component backed by Ant Design `Table`.

The table will:

- Derive columns from the union of row object keys, preserving the existing renderer behavior.
- Format primitive, object, and bigint-like values consistently with the current renderer.
- Use `virtual` with numeric `scroll.x` and `scroll.y` values for large result sets.
- Keep headers visible through Ant Design's table scrolling model.
- Use stable row keys generated from row content plus index when backend rows do not expose a unique ID.

Small tables may use the same component to avoid branching behavior.

## State And Data Flow

On startup, the app calls `getBackendInfo` and stores the result. Opening a directory calls `openPackageDirectory`, stores the scan result, clears the selected file and active result, and displays the package tree.

Selecting a supported file increments an analysis request token, stores the selected file, clears existing tabs, and calls `analyze`. Late analysis results are ignored when their token no longer matches the current selected file. AES retry and backend selection flows preserve the same stale-result protection.

Zustand actions will own these async workflows so components stay mostly presentational.

## Error Handling

Backend info failures, open-directory failures, analysis failures, AES validation failures, and backend-selection cancellation will continue producing visible status and issue content. Ant Design `Alert`, `Result`, `Modal`, `Spin`, and `Empty` can replace the current hand-written empty and error DOM.

The renderer should not use unsafe HTML injection. Values should be rendered as text or React nodes built from typed data.

## Build And Packaging

The renderer will add a build step under `node-shell` for the React bundle. The desktop app will load the built `index.html` in normal execution. Tests can run against source modules and, where useful, built static assets.

The root `npm test` command must continue to run the node-shell tests. Existing backend build commands are unaffected.

## Testing

Tests should cover:

- Type-safe scan tree to Ant Design tree data mapping.
- Supported file selection triggers analysis and stale analysis results do not overwrite the active selection.
- AES key and backend chooser flows preserve current behavior.
- Analysis table column derivation and value formatting preserve current behavior.
- Large table inputs render through the virtual table path.
- The package tree receives a numeric height and virtual scrolling remains enabled.
- Static renderer build output includes the generated bundle loaded by Electron.

Manual verification should include opening a large package directory, confirming the left tree keeps a draggable vertical scrollbar, selecting several package files, and viewing large analysis tabs without freezing the UI.

## Risks

- Ant Design virtual tree has a documented limitation around horizontal auto-width scrolling. The design accepts truncation and tooltips for long paths in the first migration.
- Migrating from direct DOM code to React touches a larger surface than a CSS-only fix. Tests must lock existing workflows before replacing renderer behavior.
- Adding a renderer build step changes development workflow. Scripts should make this explicit and keep root commands simple.
- Ant Design styling may need small overrides to keep the app dense and desktop-tool oriented instead of marketing-page-like.

## Acceptance Criteria

- Large package directories no longer expand the sidebar beyond the window height.
- The package tree has a visible, draggable vertical scrollbar when content exceeds the sidebar height.
- Large analysis result arrays are rendered through virtualized tables.
- Current backend info, open directory, analyze, AES retry, and backend chooser workflows still work.
- `npm test` passes from the repository root.
