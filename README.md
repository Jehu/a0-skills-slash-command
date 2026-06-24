# Skill Slash Commands

Adds a small command palette to the chat input:

- type `/` as the first character to list available Agent Zero skills
- type more letters to filter, e.g. `/pony`
- press Enter/Tab or click a row to insert `/skill-name `
- sending a message that starts with `/skill-name` activates that skill for the current chat through the built-in `_skills` API, then sends the remaining text

Skipped: custom backend and duplicate skill discovery; the plugin reuses Agent Zero's native Skills catalog/activation endpoint.
