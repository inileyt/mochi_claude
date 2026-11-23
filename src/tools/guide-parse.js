/*
 * Mochi Guides — reading steps out of an answer (plain functions, Node-testable).
 *
 *   G.parse({ text, items, links }) → { title, startUrl, steps: [{ text, targets: [...], action, url }] } | null
 *     items: the answer's top-level list items from the page ({ text, strong: [], code: [], links: [] }),
 *     or nothing: then numbered lines in the text ("1. …", "Step 1: …").
 *     targets: what to look for on the page, most specific first: “quoted” text, **bold**, `code`,
 *     menu paths ("Settings → Security → Two-factor"), "Click Save"-style words.
 *   G.prompt(task, lang) → a question that makes Claude answer in the format Mochi reads best.
 *   G.toFile(guide) / G.fromFile(text) → a .mochi-guide.json to share.
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const MIN_STEPS = 3, MAX_STEPS = 40, MAX_TARGETS = 4;
  const VERB = /\b(?:click|tap|press|select|choose|open|go to|navigate to|toggle|enable|disable|turn on|turn off|check|uncheck|find|switch to|expand)\s+(?:on\s+|the\s+)*/i;
  const STOP = /\s+(?:button|link|tab|menu|option|item|icon|section|page|field|toggle|checkbox|switch)\b.*$/i;
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

  function targetsOf(text, extra = {}) {
    const out = [];
    const add = t => { t = clean(t).replace(/^[\s"'“”‘’«»`*]+|[\s"'“”‘’«»`*.,:;!?]+$/g, ''); if (t.length >= 2 && t.length <= 48 && !out.some(o => o.toLowerCase() === t.toLowerCase())) out.push(t); };
    // Quoted words first: “Settings”, "Save", ‘OK’, «Войти».
    for (const m of text.matchAll(/[“"‘'«]([^“”"‘’'«»\n]{2,48})[”"’'»]/g)) add(m[1]);
    for (const s of extra.strong || []) add(s);
    for (const s of extra.code || []) add(s);
    // Quotes, bold and code say it exactly: no guessing then.
    if (out.length) return out.slice(0, MAX_TARGETS);
    // Menu paths: A → B → C (also > and »).
    const path = text.match(/([^\s→>»][^→>»\n]{0,40}?)\s*(?:→|->|>|»)\s*([^→>»\n]{1,40}?)(?:\s*(?:→|->|>|»)\s*([^→>»\n]{1,40}?))*(?=[.,;:!?)]|$|\s(?:and|then|to)\s)/);
    if (path) for (const part of path[0].split(/\s*(?:→|->|>|»)\s*/)) add(part.replace(VERB, ''));
    // "Click Save", "open the Billing page".
    const v = VERB.exec(text);
    if (v) {
      const rest = text.slice(v.index + v[0].length).split(/[.,;:!?()]|\s(?:and|then|to|in|on|at|from|under)\s/i)[0].replace(STOP, '');
      if (rest && rest.split(' ').length <= 5 && /^[A-ZА-ЯЁ0-9“"']/.test(rest.trim())) add(rest);
    }
    return out.slice(0, MAX_TARGETS);
  }

  const actionOf = text => (/\b(type|enter|paste|fill in|write)\b/i.test(text) ? 'type' : /\b(go to|navigate to|open|visit)\s+(https?:|[a-z0-9.-]+\.[a-z]{2,})/i.test(text) ? 'navigate' : VERB.test(text) ? 'click' : 'read');
  const urlsIn = text => [...String(text || '').matchAll(/https?:\/\/[^\s)<>"'`]+/g)].map(m => m[0].replace(/[.,;:!?]+$/, ''));
  const isClaude = u => { try { return /(^|\.)claude\.ai$/.test(new URL(u).hostname); } catch (_) { return true; } };

  function parse({ text = '', items = null, links = [] } = {}) {
    let raw = items;
    if (!raw || raw.length < MIN_STEPS) {
      // Numbered lines: "1. …", "1) …", "Step 1: …".
      raw = String(text).split('\n').map(l => /^\s*(?:step\s*)?(\d{1,2})[.):]\s+(.+)$/i.exec(l)).filter(Boolean).map(m => ({ text: m[2] }));
    }
    if (!raw || raw.length < MIN_STEPS) return null;
    const steps = raw.slice(0, MAX_STEPS).map(it => {
      const t = clean(it.text);
      const url = (it.links || []).concat(urlsIn(t)).find(u => !isClaude(u)) || null;
      return { text: t, targets: targetsOf(t, it), action: actionOf(t), url };
    }).filter(s => s.text);
    if (steps.length < MIN_STEPS) return null;
    const startUrl = steps.find(s => s.url)?.url || links.concat(urlsIn(text)).find(u => !isClaude(u)) || null;
    const first = clean(String(text).split('\n').find(l => l.trim() && !/^\s*\d/.test(l)) || '');
    let host = null;
    try { host = startUrl ? new URL(startUrl).hostname.replace(/^www\./, '') : null; } catch (_) { host = null; }
    return { title: (first || steps[0].text).slice(0, 90), startUrl, host, steps };
  }

  const LANGS = { de: 'German', es: 'Spanish', fr: 'French', hy: 'Armenian', it: 'Italian', ja: 'Japanese', pt: 'Portuguese', ru: 'Russian', uk: 'Ukrainian', zh: 'Chinese' };
  function prompt(task, lang = 'en') {
    return [
      `How do I ${String(task || '').trim().replace(/[.?!]+$/, '')}? Please answer as a step-by-step guide that I'll follow on the website:`,
      '- First give the full address (https://…) of the page to start on.',
      '- Then a numbered list, one action per step.',
      '- In each step put the exact text of the button, link, tab or field to use in "double quotes", as it appears on the screen, and write menu paths with → (e.g. "Settings" → "Security").',
      '- Say what I should see after the step when it helps.',
      ...(LANGS[lang] ? [`Write the explanations in ${LANGS[lang]}, but keep the button texts exactly as they are on the site.`] : []),
    ].join('\n');
  }

  const toFile = g => JSON.stringify({ app: 'mochi', kind: 'guide', version: 1, title: g.title, startUrl: g.startUrl, host: g.host, steps: g.steps.map(({ text, targets, action, url, recorded }) => ({ text, targets, action, url, recorded })) }, null, 2);
  function fromFile(text) {
    let d;
    try { d = JSON.parse(text); } catch (_) { throw Object.assign(new Error('not-json'), { code: 'bad-file' }); }
    if (d?.kind !== 'guide' || !Array.isArray(d.steps) || !d.steps.length) throw Object.assign(new Error('not-a-guide'), { code: 'bad-file' });
    const steps = d.steps.slice(0, MAX_STEPS).filter(s => typeof s?.text === 'string').map(s => ({ text: clean(s.text).slice(0, 400), targets: (Array.isArray(s.targets) ? s.targets : targetsOf(s.text)).map(String).slice(0, MAX_TARGETS), action: ['click', 'type', 'navigate', 'read'].includes(s.action) ? s.action : 'read', url: typeof s.url === 'string' && /^https?:/.test(s.url) ? s.url : null, recorded: !!s.recorded }));
    const startUrl = typeof d.startUrl === 'string' && /^https?:/.test(d.startUrl) ? d.startUrl : null;
    return { title: clean(d.title || 'Guide').slice(0, 90), startUrl, host: startUrl ? new URL(startUrl).hostname.replace(/^www\./, '') : null, steps };
  }

  Mochi.guideParse = { parse, targetsOf, actionOf, prompt, toFile, fromFile, MIN_STEPS };
  if (typeof module !== 'undefined') module.exports = Mochi.guideParse;
})();
