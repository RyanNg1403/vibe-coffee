export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const root = document.documentElement;

export function html(strings, ...values) {
  return strings.reduce((out, string, i) => out + string + (i < values.length ? values[i] : ''), '');
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const FOCUSABLE = 'button:not([disabled]):not([hidden]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function focusables(container) {
  return $$(FOCUSABLE, container).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

// Keeps Tab inside `container`; returns a release function.
export function trapFocus(container) {
  const onKey = (event) => {
    if (event.key !== 'Tab') return;
    const items = focusables(container);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
    else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
  };
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}

// Paints the filled portion of a range input's track.
export function syncRangeFill(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 1);
  const pct = ((Number(input.value) - min) / (max - min || 1)) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}

// Sets an input's value as if the visitor moved it, so the app's own
// listeners apply and persist the change.
export function setInputValue(input, value) {
  if (!input) return;
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  syncRangeFill(input);
}

export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
