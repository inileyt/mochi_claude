/*
 * Mochi — reading Gemini (gemini.google.com), only when you enable it in
 * Mochi's settings. See src/site.js for what an adapter answers.
 *
 * Assumed page shape (check on the real site if reactions stop working):
 *   messages      <user-query> and <model-response> elements
 *                 (text in .query-text / message-content .model-response-text)
 *   writing       a "Stop response" button (aria-label), or <model-response> without a
 *                 finished footer; the send button gets class "stop"
 *   message box   rich-textarea .ql-editor[contenteditable="true"] (a Quill editor)
 *   theme         <body class="dark-theme"> or "light-theme"
 *   new chat      the address is "/app" (a conversation is /app/<id>)
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  Mochi.sites.register({
    id: 'gemini',
    name: 'Gemini',
    hosts: ['gemini.google.com'],
    selectors: {
      userMessage: ['user-query', '.user-query-container'],
      assistantMessage: ['model-response', '.model-response-text'],
      streaming: ['button[aria-label="Stop response"]', 'button.send-button.stop', '.stop-icon'],
      input: ['rich-textarea .ql-editor[contenteditable="true"]', '.ql-editor[contenteditable="true"]', 'rich-textarea [contenteditable="true"]', '.text-input-field textarea'],
    },
    composerBox: 'input-area-v2, .input-area, .input-area-container, form, fieldset',
    watchAttributes: ['class', 'aria-label'],
    theme() {
      const c = document.body?.classList;
      return c?.contains('dark-theme') ? 'dark' : c?.contains('light-theme') ? 'light' : null;
    },
    isNewChat: (path, previous, userCount) => /^\/app\/?$/.test(path) || (userCount === 0 && !/^\/app\/./.test(previous)),
  });
})();
