# Repository Agent Instructions

## C++ Backend Changes

Whenever modifying files under `ue-backend/**/*.cpp`, `ue-backend/**/*.h`, or
`ue-backend/**/*.cs`, follow `.agents/workflow/update-native-backend.md` before finishing.

Generated backend manifests and DLLs must be updated together with C++ behavior changes when the
native backend build can run.

Do not use project-local PowerShell scripts for backend staging, backend building, or protocol
generation. Use the root npm commands and JavaScript scripts.

## Workflow Configuration

Do not add environment variable dependencies to repository workflows. Workflow variables must come
from explicit command-line parameters or configuration files.

Do not read workflow variables from environment variables. If a value needs to be configurable,
add a parameter or a configuration file entry instead.

## GUI Changes

Whenever modifying the GUI, including files under `node-shell/apps/desktop/**`,
`node-shell/bin/upi-gui.js`, `start-gui.bat`, renderer build configuration, or GUI-related package
scripts, run a fresh Electron GUI smoke test before finishing.

The Electron GUI smoke test must launch the app and inspect the renderer through DevTools Protocol.
Verify that the renderer reports no runtime exceptions, `#root` has mounted content,
the expected visible UI text is present, and the preload API is available as `window.upi`.

When the GUI change affects a specific interaction, component, view, layout behavior, or renderer
data flow, add or update a renderer regression test for the changed behavior. If a meaningful
automated regression test is not practical, state the reason and include the manual or DevTools
Protocol smoke evidence before claiming the GUI change works.
