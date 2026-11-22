/*
 * Mochi — reading claude.ai (see src/site.js for what an adapter answers).
 * These selectors were found on claude.ai; lists are tried in order.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  Mochi.sites.register({
    id: 'claude',
    name: 'Claude',
    hosts: ['claude.ai'],
    selectors: {
      // Messages the person sent.
      userMessage: ['[data-testid="user-message"]', '[data-testid="user-human-turn"]'],
      // Claude's replies (the last one is the reply being written).
      assistantMessage: ['[data-is-streaming]', '.font-claude-response', '.font-claude-message', '[data-testid="assistant-message"]'],
      // Any of these on screen means Claude is answering right now.
      streaming: ['[data-is-streaming="true"]', 'button[aria-label="Stop response"]', 'button[aria-label="Stop Response"]', 'button[aria-label="Stop"]', 'button[data-testid="stop-button"]'],
      // The message box.
      input: ['div.ProseMirror[contenteditable="true"]', '[data-testid="chat-input"] [contenteditable="true"]', 'div[contenteditable="true"]', 'fieldset textarea', 'textarea'],
    },
    composerBox: 'fieldset, form',
    watchAttributes: ['data-is-streaming', 'aria-label', 'data-testid'],
    // claude.ai is a single-page app: /new is a fresh chat; so is landing on a chat with no messages.
    isNewChat: (path, previous, userCount) => /\/new\/?$/.test(path) || (userCount === 0 && !/\/new\/?$/.test(previous)),
  });
  Mochi.config.selectors = Mochi.sites.get('claude').selectors; // older code and docs refer to these
})();
