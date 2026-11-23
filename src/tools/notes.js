/* Mochi — tool "notes" (filled in by its own subtask). */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  let open = false;
  Mochi.toolImpl.notes = { open() { open = true; return true; }, close() { open = false; }, get isOpen() { return open; } };
})();
