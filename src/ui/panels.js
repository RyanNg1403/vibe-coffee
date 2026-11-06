// Popover coordination: one open at a time, toggled from its trigger,
// dismissed by Escape or a pointer press outside, focus returned on close.
import { $, focusables } from './dom.js';

const panels = new Map(); // id -> { panel, trigger, onOpen, onClose }
let openId = null;
const listeners = new Set();

export function registerPanel(id, { trigger, onOpen, onClose } = {}) {
  const panel = document.getElementById(id);
  if (!panel) return;
  panels.set(id, { panel, trigger, onOpen, onClose });
  trigger?.addEventListener('click', () => togglePanel(id));
}

export function isPanelOpen(id) {
  return id ? openId === id : openId !== null;
}

export function openPanel(id, { focus = false } = {}) {
  if (openId === id) return;
  closePanel();
  const entry = panels.get(id);
  if (!entry) return;
  openId = id;
  entry.panel.hidden = false;
  entry.trigger?.setAttribute('aria-expanded', 'true');
  entry.onOpen?.();
  if (focus) focusables(entry.panel)[0]?.focus();
  listeners.forEach((fn) => fn(openId));
}

export function closePanel({ restoreFocus = false } = {}) {
  if (!openId) return;
  const entry = panels.get(openId);
  openId = null;
  entry.panel.hidden = true;
  entry.trigger?.setAttribute('aria-expanded', 'false');
  entry.onClose?.();
  if (restoreFocus) entry.trigger?.focus();
  listeners.forEach((fn) => fn(openId));
}

export function togglePanel(id, options) {
  if (openId === id) closePanel(options);
  else openPanel(id, options);
}

export function onPanelChange(fn) {
  listeners.add(fn);
}

document.addEventListener('pointerdown', (event) => {
  if (!openId) return;
  const { panel, trigger } = panels.get(openId);
  if (panel.contains(event.target) || trigger?.contains(event.target)) return;
  // Pressing another panel's trigger switches panels through its own click.
  for (const entry of panels.values()) if (entry.trigger?.contains(event.target)) return;
  if ($('#settings')?.contains(event.target)) return;
  closePanel();
});
