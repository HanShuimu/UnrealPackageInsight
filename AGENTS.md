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
