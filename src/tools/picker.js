/* Mochi — tool "picker" (filled in by its own subtask). */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  let open = false;
  Mochi.toolImpl.picker = { open() { open = true; return true; }, close() { open = false; }, get isOpen() { return open; } };
})();
