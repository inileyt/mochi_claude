/* Mochi — tool "fonts" (filled in by its own subtask). */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  let open = false;
  Mochi.toolImpl.fonts = { open() { open = true; return true; }, close() { open = false; }, get isOpen() { return open; } };
})();
