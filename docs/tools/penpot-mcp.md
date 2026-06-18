# Penpot MCP

This repository keeps the Codex-side Penpot MCP endpoint in
`.codex/config.toml` and starts the local Penpot MCP server through npm scripts.

## Foreground Server

```powershell
npm run penpot:mcp
```

This launches `@penpot/mcp@latest`, which serves the MCP endpoint at
`http://localhost:4401/mcp` and the Penpot plugin manifest at
`http://localhost:4400/manifest.json`.

Keep the terminal process running while using Penpot MCP. The terminal window
can be minimized, but closing it stops the MCP server and plugin server.

## Background Server

Use the background scripts when you do not want to keep a terminal window open:

```powershell
npm run penpot:mcp:start
npm run penpot:mcp:status
npm run penpot:mcp:stop
```

The background runner writes runtime state and logs under
`artifacts/penpot-mcp/`:

- `server.json`: the tracked background process ID and endpoint metadata.
- `server.log`: output from `@penpot/mcp`.

The background process stays alive until it is stopped, the user signs out, or
Windows restarts. After a Windows restart, run `npm run penpot:mcp:start` again.

On Windows, the batch wrappers call the same npm scripts:

```bat
start-penpot-mcp.bat
status-penpot-mcp.bat
stop-penpot-mcp.bat
```

## Connect Penpot

1. Open a Penpot design file.
2. Open the Plugins menu.
3. Load the development plugin URL:

   ```text
   http://localhost:4400/manifest.json
   ```

4. Open the plugin UI and click `Connect to MCP server`.

Keep the plugin UI open while using MCP. Closing the plugin UI closes its
connection to the local MCP server.

## Connect Codex

Codex loads the project MCP entry from `.codex/config.toml` when this repository
is trusted:

```toml
[mcp_servers.penpot]
url = "http://localhost:4401/mcp"
```

Restart Codex after adding or changing MCP configuration. If Penpot tools do not
show up after restart, check these in order:

1. `npm run penpot:mcp:status` reports the background service as reachable, or
   the foreground `npm run penpot:mcp` command is still running.
2. The Penpot plugin UI is open and connected.
3. The current Codex project is trusted, so project `.codex/config.toml` is
   loaded.
