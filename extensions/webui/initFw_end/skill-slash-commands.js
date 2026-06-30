import { callJsonApi } from "/js/api.js";
import { store as chatInputStore } from "/components/chat/input/input-store.js";
import { store as chatsStore } from "/components/sidebar/chats/chats-store.js";
import { toastFrontendError, toastFrontendInfo } from "/components/notifications/notification-store.js";

const PLUGIN_NAME = "skill_slash_commands";
const SKILLS_API = "/plugins/_skills/skills_catalog";
const COMMANDS_API = "/plugins/commands/commands";
const BOX_ID = "skill-slash-command-palette";
const STYLE_ID = "skill-slash-command-style";
const VIRTUAL_SKILL_COMMAND = "skill_slash_commands.context_skill";
const DEFAULT_CONFIG = {
  include_pinned_skills: true,
  include_chat_skills: true,
  include_visible_skills: true,
};

let commandSkills = [];
let open = false;
let selected = 0;
let originalSendMessage = null;
let commandsStorePatched = false;

function contextId() {
  return chatsStore?.getSelectedChatId?.() || chatsStore.selected || globalThis.getContext?.() || "";
}

function projectName() {
  return chatsStore.selectedContext?.project?.name || "";
}

function agentProfile() {
  return chatsStore.selectedContext?.agent_profile || chatsStore.selectedContext?.agentProfile || "";
}

function normalizeConfig(config = {}) {
  return {
    include_pinned_skills: config.include_pinned_skills !== false,
    include_chat_skills: config.include_chat_skills !== false,
    include_visible_skills: config.include_visible_skills !== false,
  };
}

async function loadPluginConfig() {
  try {
    const response = await callJsonApi("plugins", {
      action: "get_config",
      plugin_name: PLUGIN_NAME,
      project_name: projectName(),
      agent_profile: agentProfile(),
    });
    return normalizeConfig({ ...DEFAULT_CONFIG, ...(response?.data || {}) });
  } catch (error) {
    console.warn("Failed to load Skill Slash Commands settings; using defaults:", error);
    return { ...DEFAULT_CONFIG };
  }
}

function entryKey(skill) {
  const path = String(skill?.path || "").trim().toLowerCase();
  const name = String(skill?.name || "").trim().toLowerCase();
  return path || name;
}

function mergeSkillEntries(...groups) {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const skill of group) {
      const key = entryKey(skill);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(skill);
    }
  }
  return merged;
}

function skillName(skill) {
  return String(skill?.name || "").trim();
}

function commandName(skill) {
  return skillName(skill).toLowerCase();
}

function skillCommandPath(skill) {
  const name = commandName(skill);
  return `skill-slash-commands://context/${encodeURIComponent(name)}`;
}

function parseSlash(text) {
  const match = String(text || "").match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1].toLowerCase(), rest: match[2] || "" };
}

function commandMatch(text) {
  const parsed = parseSlash(text);
  if (!parsed) return null;
  const skill = commandSkills.find((item) => commandName(item) === parsed.name);
  return skill ? { skill, rest: parsed.rest } : null;
}

async function loadCommandSkills() {
  const [config, result] = await Promise.all([
    loadPluginConfig(),
    callJsonApi(SKILLS_API, {
      action: "list",
      context_id: contextId(),
      project_name: projectName(),
    }),
  ]);

  if (!result?.ok) {
    commandSkills = [];
    return commandSkills;
  }

  const groups = [];
  if (config.include_pinned_skills) groups.push(result.scope_skills);
  if (config.include_chat_skills) groups.push(result.chat_skills);
  if (config.include_visible_skills) groups.push(result.visible_skills, result.active_skills);

  commandSkills = mergeSkillEntries(...groups);
  return commandSkills;
}

function virtualCommandForSkill(skill) {
  const name = commandName(skill);
  if (!name) return null;
  const stateSource = skill.state_source || "Context skill";
  return {
    name,
    description: skill.description || skill.origin || stateSource,
    argument_hint: "[prompt]",
    command_type: "virtual-skill",
    path: skillCommandPath(skill),
    content_path: "",
    directory_path: "",
    source_plugin: PLUGIN_NAME,
    scope_key: "context-skill",
    scope_label: stateSource,
    source_scope_key: "context-skill",
    source_scope_label: stateSource,
    [VIRTUAL_SKILL_COMMAND]: true,
    skill: { name: skill.name, path: skill.path || "" },
  };
}

function mergeSkillCommands(commands, skills) {
  const base = Array.isArray(commands) ? commands : [];
  const existing = new Set(base.map((command) => String(command?.name || "").trim().toLowerCase()).filter(Boolean));
  const virtual = (Array.isArray(skills) ? skills : [])
    .map(virtualCommandForSkill)
    .filter((command) => command && !existing.has(command.name));
  return [...base, ...virtual].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function setInputText(text) {
  const ta = document.getElementById("chat-input");
  chatInputStore.message = text;
  if (ta) {
    ta.value = text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    chatInputStore.adjustTextareaHeight?.();
    ta.focus();
    ta.setSelectionRange(text.length, text.length);
  }
}

async function applySkillCommand(skill, rawArguments = "") {
  let ctx = contextId();
  if (!ctx) {
    ctx = await chatsStore.newChat?.();
    if (!ctx) {
      await toastFrontendInfo("Start a chat before using a skill slash command.", "Skill Slash Commands");
      return true;
    }
  }

  const result = await callJsonApi(SKILLS_API, {
    action: "activate",
    context_id: ctx,
    skill: { name: skill.name, path: skill.path || "" },
  });
  if (!result?.ok) throw new Error(result?.error || "Skill activation failed");

  const name = skillName(skill);
  setInputText(String(rawArguments || "").trim() || `Nutze den Skill \`${name}\`.`);
  return false;
}

async function commandsAvailable() {
  try {
    const result = await callJsonApi(COMMANDS_API, {
      action: "list_effective",
      context_id: contextId(),
    });
    return Boolean(result?.ok && Array.isArray(result.commands));
  } catch (_error) {
    return false;
  }
}

async function patchCommandsStore() {
  if (commandsStorePatched) return true;
  let commandsSlash;
  try {
    ({ store: commandsSlash } = await import("/plugins/commands/webui/commands-slash-store.js"));
  } catch (_error) {
    return false;
  }
  if (!commandsSlash || commandsSlash.__skillSlashCommandsPatched) return Boolean(commandsSlash);

  const originalLoadCommands = commandsSlash.loadCommands?.bind(commandsSlash);
  const originalApplySelection = commandsSlash.applySelection?.bind(commandsSlash);
  if (!originalLoadCommands || !originalApplySelection) return false;

  commandsSlash.loadCommands = async function patchedLoadCommands(force = false) {
    await originalLoadCommands(force);
    try {
      const skills = await loadCommandSkills();
      this.commands = mergeSkillCommands(this.commands, skills);
      this.ensureSelection?.();
    } catch (error) {
      console.error("Failed to append skill slash commands:", error);
    }
  };

  commandsSlash.applySelection = async function patchedApplySelection(command) {
    if (command?.[VIRTUAL_SKILL_COMMAND]) {
      if (this.applying) return;
      this.applying = true;
      try {
        await applySkillCommand(command.skill || {}, this.rawArguments || "");
        this.active = false;
        this.dismissed = false;
        this.query = "";
        this.rawArguments = "";
        this.selectedIndex = 0;
      } catch (error) {
        console.error("Failed to apply skill slash command:", error);
        await toastFrontendError(error?.message || String(error), "Skill Slash Commands");
      } finally {
        this.applying = false;
      }
      return;
    }
    return originalApplySelection(command);
  };

  commandsSlash.__skillSlashCommandsPatched = true;
  commandsStorePatched = true;
  window.dispatchEvent(new CustomEvent("commands:updated"));
  return true;
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${BOX_ID} {
      position: fixed;
      z-index: 9999;
      min-width: 18rem;
      max-width: min(34rem, calc(100vw - 2rem));
      max-height: 18rem;
      overflow: auto;
      display: none;
      border: 1px solid var(--color-border, #444);
      border-radius: .75rem;
      background: var(--color-bg-secondary, #1f1f1f);
      box-shadow: 0 12px 36px rgba(0,0,0,.35);
      padding: .35rem;
    }
    #${BOX_ID}.open { display: block; }
    #${BOX_ID} button {
      width: 100%;
      display: block;
      text-align: left;
      border: 0;
      border-radius: .5rem;
      background: transparent;
      color: var(--color-text-primary, inherit);
      padding: .55rem .65rem;
      cursor: pointer;
    }
    #${BOX_ID} button.active, #${BOX_ID} button:hover { background: var(--color-bg-tertiary, rgba(255,255,255,.08)); }
    #${BOX_ID} .name { font-weight: 600; }
    #${BOX_ID} .desc { opacity: .72; font-size: .82rem; margin-top: .15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;
  document.head.appendChild(style);
}

function box() {
  let el = document.getElementById(BOX_ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = BOX_ID;
  el.setAttribute("role", "listbox");
  document.body.appendChild(el);
  return el;
}

function input() {
  return document.getElementById("chat-input");
}

function query() {
  const text = chatInputStore.message || input()?.value || "";
  return text.startsWith("/") && !text.includes(" ") ? text.slice(1).toLowerCase() : null;
}

function filtered() {
  const q = query();
  if (q === null) return [];
  return commandSkills
    .filter((skill) => {
      const haystack = [skill.name, skill.description, skill.origin, skill.state_source].join(" ").toLowerCase();
      return haystack.includes(q);
    })
    .slice(0, 12);
}

function placePalette() {
  const ta = input();
  if (!ta) return;
  const rect = ta.getBoundingClientRect();
  const el = box();
  el.style.left = `${Math.max(8, rect.left)}px`;
  el.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 6)}px`;
}

function closePalette() {
  open = false;
  box().classList.remove("open");
}

function selectSkill(skill) {
  const name = commandName(skill);
  if (!name) return;
  setInputText(`/${name} `);
  closePalette();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function render() {
  const q = query();
  if (q === null) return closePalette();
  await loadCommandSkills();
  const items = filtered();
  selected = Math.min(selected, Math.max(0, items.length - 1));
  const el = box();
  el.innerHTML = items.length
    ? items.map((skill, index) => `
        <button type="button" data-index="${index}" class="${index === selected ? "active" : ""}">
          <div class="name">/${escapeHtml(commandName(skill))}</div>
          <div class="desc">${escapeHtml(skill.description || skill.state_source || skill.origin || "Context skill")}</div>
        </button>
      `).join("")
    : `<button type="button" disabled><div class="name">No matching configured skills</div></button>`;
  el.querySelectorAll("button[data-index]").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectSkill(items[Number(button.dataset.index)]);
    });
  });
  placePalette();
  open = true;
  el.classList.add("open");
}

async function expandCommandBeforeSend() {
  await loadCommandSkills();
  const match = commandMatch(chatInputStore.message);
  if (!match) return false;
  return applySkillCommand(match.skill, match.rest.trim());
}

function patchSendMessage() {
  if (originalSendMessage) return;
  originalSendMessage = chatInputStore.sendMessage.bind(chatInputStore);
  chatInputStore.sendMessage = async function patchedSendMessage() {
    try {
      const stop = await expandCommandBeforeSend();
      if (stop) return;
    } catch (error) {
      await toastFrontendError(error?.message || String(error), "Skill Slash Commands");
      return;
    }
    await originalSendMessage();
  };
}

function attachToInput(ta) {
  if (!ta || ta.dataset.skillSlashCommands === "1") return;
  ta.dataset.skillSlashCommands = "1";
  ta.addEventListener("input", () => { selected = 0; void render(); });
  ta.addEventListener("keydown", (event) => {
    if (!open) return;
    const items = filtered();
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      selected = Math.min(selected + 1, items.length - 1);
      void render();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selected = Math.max(selected - 1, 0);
      void render();
    } else if ((event.key === "Tab" || event.key === "Enter") && items[selected]) {
      event.preventDefault();
      selectSkill(items[selected]);
    }
  }, true);
  ta.addEventListener("blur", () => setTimeout(closePalette, 150));
}

function scan() {
  attachToInput(input());
}

function enableFallbackUi() {
  ensureStyle();
  patchSendMessage();
  scan();
  document.addEventListener("click", (event) => {
    if (!box().contains(event.target) && event.target !== input()) closePalette();
  });
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
}

export default async function initSkillSlashCommands() {
  if (await commandsAvailable() && await patchCommandsStore()) {
    return;
  }
  enableFallbackUi();
}
