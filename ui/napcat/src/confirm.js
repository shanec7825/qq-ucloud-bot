// The native extension iframe omits allow-modals; use its same-origin host's dialog.
export function confirmAction(message) {
  try {
    if(window.parent!==window&&window.parent.location.origin===location.origin)return window.parent.confirm(message);
  } catch { /* Standalone or cross-origin pages use their own dialog. */ }
  return window.confirm(message);
}
