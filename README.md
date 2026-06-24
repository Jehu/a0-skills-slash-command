# Skill Slash Commands

Agent Zero plugin that adds `/skill` autocomplete to the chat composer.

Type `/` as the first character in the chat input and the plugin shows the available Agent Zero skills. Selecting a skill inserts `/skill-name `. When the message is sent, the plugin activates that skill for the current chat through Agent Zero's native Skills API, then sends the remaining prompt.

## Features

- `/` autosuggest in the chat input
- filters skills while typing, e.g. `/pony`
- select with `Enter`, `Tab`, arrow keys, or click
- activates skills through the built-in `_skills` API
- reuses Agent Zero's native skill catalog and project/chat resolution
- no backend code and no extra dependencies

## Installation

Clone or copy this repository into your Agent Zero user plugins directory:

```bash
cd /a0/usr/plugins
git clone git@github.com:Jehu/a0-skills-slash-command.git skill_slash_commands
```

Then restart or reload Agent Zero so the WebUI extension is discovered.

## Usage

Open the chat input and type:

```text
/
```

Examples:

```text
/ponytail
/ponytail simplify this code
/document-query summarize this PDF
```

Behavior:

1. `/` opens the skill palette.
2. Selecting a skill inserts `/skill-name `.
3. Sending `/skill-name prompt text` activates the skill for the current chat.
4. Agent Zero receives `prompt text` with the selected skill already active.

If no prompt text is provided, the plugin sends a small fallback message asking Agent Zero to use the selected skill.

## Agent Zero plugin standards check

Current status: **local-use ready**.

Verified:

- `plugin.yaml` exists at the plugin root
- `name`, `title`, `description`, and `version` are present
- plugin name matches `^[a-z0-9_]+$`
- `settings_sections` is a list
- `per_project_config` and `per_agent_config` are booleans
- extension path uses the supported layout: `extensions/webui/initFw_end/`
- no Python backend, tools, hooks, install scripts, or extra dependencies
- no hardcoded secrets found
- no `eval()` / `exec()` usage
- JavaScript syntax passes:

```bash
node --check extensions/webui/initFw_end/skill-slash-commands.js
```

Community Plugin Index note:

- A root `LICENSE` file is required before submitting this plugin to the Agent Zero Plugin Index.
- For local installation, `LICENSE` is optional.

## Design

This plugin intentionally stays small:

- no custom skill discovery backend
- no duplicate skill activation logic
- no settings UI
- no persisted plugin state

It calls Agent Zero's native endpoint:

```text
/plugins/_skills/skills_catalog
```

Skipped: custom backend and duplicate skill registry; add only if the native Skills API stops covering this use case.
