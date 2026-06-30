# Skill Slash Commands

Agent Zero plugin that exposes selected skills from the current chat/project context as direct slash commands.

Examples:

```text
/document-query summarize this PDF
/browser-automation inspect this form
/mcp2cli list configured MCP servers
```

## Configurable sources

The plugin settings provide three toggle options. All are enabled by default:

| Setting | Source from Agent Zero Skills API |
|---|---|
| Pinned/default skills | `scope_skills` |
| Chat/session skills | `chat_skills` |
| Visible/loaded active skills | `visible_skills` + `active_skills` |

The final command list is the deduplicated union of the enabled sources.

## Behavior

### With the Commands plugin installed

When `/a0/usr/plugins/commands` is available, this plugin patches the Commands slash menu client-side and appends virtual commands for the configured skill sources.

- Existing user/project/global Commands remain unchanged.
- Real Commands with the same name win over virtual skill commands.
- Skill command entries show their source, e.g. `Pinned default`, `Chat`, or `Visible in chat`.

### Without the Commands plugin

If the Commands API is unavailable, this plugin enables a lightweight fallback UI:

- typing `/` opens a palette of configured context skills
- filtering works while typing
- selection inserts `/skill-name `
- sending `/skill-name prompt text` activates/refreshes that skill and sends `prompt text`

## Settings

This plugin exposes settings under the Agent settings tab and supports project/agent scoped configuration.

Defaults:

```yaml
include_pinned_skills: true
include_chat_skills: true
include_visible_skills: true
```

## Files

```text
plugin.yaml
default_config.yaml
webui/config.html
extensions/webui/initFw_end/skill-slash-commands.js
```

## Validation

```bash
node --check extensions/webui/initFw_end/skill-slash-commands.js
```
