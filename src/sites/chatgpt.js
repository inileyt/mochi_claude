/*
 * Mochi — reading ChatGPT (chatgpt.com), only when you enable it in Mochi's
 * settings. See src/site.js for what an adapter answers.
 *
 * Assumed page shape (check on the real site if reactions stop working):
 *   messages      [data-message-author-role="user" | "assistant"]
 *   writing       the stop button: [data-testid="stop-button"] / aria-label "Stop streaming";
 *                 older pages: .result-streaming on the reply
 *   message box   #prompt-textarea (a contenteditable ProseMirror div, or a textarea)
 *   theme         <html class="dark"> or <html class="light">
 *   new chat      the address is "/" (a conversation is /c/<id>)
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  Mochi.sites.register({
    id: 'chatgpt',
    name: 'ChatGPT',
    hosts: ['chatgpt.com'],
    optional: true, // only after you turn it on (src/site-access.js)
    streamingByGrowth: true, // the Stop button changes often: a growing answer also counts as being written
    selectors: {
      userMessage: ['[data-message-author-role="user"]'],
      assistantMessage: ['[data-message-author-role="assistant"]'],
      streaming: ['[data-testid="stop-button"]', 'button[aria-label="Stop streaming"]', 'button[aria-label="Stop generating"]', 'form button[aria-label^="Stop"]', '.result-streaming', '.streaming-animation'],
      input: ['#prompt-textarea[contenteditable="true"]', 'div#prompt-textarea', 'textarea#prompt-textarea', 'form [contenteditable="true"]', 'form textarea'],
    },
    composerBox: 'form',
    watchAttributes: ['class', 'aria-label', 'data-testid'],
    theme() {
      const c = document.documentElement.classList;
      return c.contains('dark') ? 'dark' : c.contains('light') ? 'light' : null;
    },
    isNewChat: (path, previous, userCount) => path === '/' || (userCount === 0 && !/^\/c\//.test(previous)),
  });
})();
