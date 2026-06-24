import { callJsonApi } from "/js/api.js";
import { store as chatInputStore } from "/components/chat/input/input-store.js";
import { store as chatsStore } from "/components/sidebar/chats/chats-store.js";
import { toastFrontendError, toastFrontendInfo } from "/components/notifications/notification-store.js";

const API = "/plugins/_skills/skills_catalog";
const BOX_ID = "skill-slash-command-palette";
const STYLE_ID = "skill-slash-command-style";

let skills = [];
let open = false;
let selected = 0;
let originalSendMessage = null;

function contextId() {
  return chatsStore.selected || globalThis.getContext?.() || "";
}

function projectName() {
  return chatsStore.selectedContext?.project?.name || "";
}

function commandName(skill) {
  return String(skill?.name || "").trim();
}

function commandMatch(text) {
  const match = String(text || "").match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const skill = skills.find((item) => commandName(item).toLowerCase() === name);
  return skill ? { skill, rest: match[2] || "" } : null;
}

async function loadSkills() {
  const result = await callJsonApi(API, {
    action: "list",
    context_id: contextId(),
    project_name: projectName(),
  });
  skills = result?.ok && Array.isArray(result.skills) ? result.skills : [];
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
  return skills
    .filter((skill) => {
      const haystack = [skill.name, skill.description].join(" ").toLowerCase();
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
  chatInputStore.message = `/${name} `;
  const ta = input();
  if (ta) {
    ta.value = chatInputStore.message;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    ta.selectionStart = ta.selectionEnd = ta.value.length;
  }
  closePalette();
}

async function render() {
  const q = query();
  if (q === null) return closePalette();
  if (!skills.length) await loadSkills();
  const items = filtered();
  selected = Math.min(selected, Math.max(0, items.length - 1));
  const el = box();
  el.innerHTML = items.length
    ? items.map((skill, index) => `
        <button type="button" data-index="${index}" class="${index === selected ? "active" : ""}">
          <div class="name">/${escapeHtml(commandName(skill))}</div>
          <div class="desc">${escapeHtml(skill.description || skill.origin || "Skill")}</div>
        </button>
      `).join("")
    : `<button type="button" disabled><div class="name">No matching skills</div></button>`;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function expandCommandBeforeSend() {
  if (!skills.length) await loadSkills();
  const match = commandMatch(chatInputStore.message);
  if (!match) return false;
  let ctx = contextId();
  if (!ctx) {
    ctx = await chatsStore.newChat?.();
    if (!ctx) {
      await toastFrontendInfo("Start a chat before activating a skill slash command.", "Skill Slash Commands");
      return true;
    }
  }
  const result = await callJsonApi(API, {
    action: "activate",
    context_id: ctx,
    skill: { name: match.skill.name, path: match.skill.path },
  });
  if (!result?.ok) throw new Error(result?.error || "Skill activation failed");

  // ponytail: no separate command protocol; activate the native skill and send the remaining prompt.
  chatInputStore.message = match.rest.trim() || `Nutze den Skill \`${match.skill.name}\`.`;
  const ta = input();
  if (ta) {
    ta.value = chatInputStore.message;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return false;
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

export default async function initSkillSlashCommands() {
  ensureStyle();
  patchSendMessage();
  scan();
  document.addEventListener("click", (event) => {
    if (!box().contains(event.target) && event.target !== input()) closePalette();
  });
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
}
