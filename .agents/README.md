# Agent Environment

This directory is the canonical repo-local Agent environment.

Start with `AGENTS.md`; it is the normative engineering contract. The files here only encode repeatable workflows for common tasks.

## Layout

- `skills/*/SKILL.md` are the canonical reusable task workflows.

## Tool-specific adapters

- Claude Code reads `.claude/`; each `.claude/skills/*/SKILL.md` is a thin adapter that points back to the canonical `.agents/skills/*/SKILL.md`.
- Codex should read `AGENTS.md` first and can use this `.agents/skills/` directory as the repo-local skill catalog.
- Cursor reads `.cursor/rules/`; those rules point back to `AGENTS.md` and this directory.

When updating a workflow, update the canonical file under `.agents/skills/` first. Keep tool-specific adapters thin.
