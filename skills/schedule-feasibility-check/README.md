# Schedule feasibility check: an agent skill

An agent skill that hands "does this schedule work?" to a deterministic
referee instead of letting the model guess. It uses the free `lattice117-mcp`
server from the npm package `lattice117-verify`.

- `SKILL.md`: the skill itself, which the agent reads.
- `mcp/`: one-line set-up for Claude Desktop, Cursor, VS Code with Copilot
  and Windows. Claude Code: `claude mcp add lattice117 -- npx -y -p lattice117-verify@0.3.0 lattice117-mcp`
  (on native Windows: `claude mcp add lattice117 -- cmd /c npx -y -p lattice117-verify@0.3.0 lattice117-mcp`).
- `examples/`: five worked calls. Each file holds the tool, its arguments and
  the expected summary and digest; `tests/skill.test.mjs` runs every one on
  each push, so the examples cannot drift from the engine.

Build the zip a marketplace takes (SKILL.md at the root):

```sh
python3 tools/build_skill_zip.py skills/schedule-feasibility-check
```

The zip is reproducible: the same files give the same bytes and the same
SHA-256, which the script prints.
