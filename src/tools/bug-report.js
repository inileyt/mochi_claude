/*
 * Mochi — Bug Reporter: the report itself (plain functions, Node-testable).
 *   B.markdown({ title, expected, actual, steps, events, env, shots }) → report.md
 *   B.forClaude(md) → the report with a request to find the cause
 *   B.summary(events) → { errors, warnings, failed }
 * steps: [{ text, url, at }] · events: from the debugger proxy's report mode (exception, console, log,
 * http, failed) · env: { url, title, ua, viewport, dpr, lang, time } · shots: [{ name, step }]
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const fence = t => String(t).replace(/```/g, '`​``');

  function summary(events = []) {
    return {
      errors: events.filter(e => e.kind === 'exception' || ((e.kind === 'console' || e.kind === 'log') && e.level === 'error')).length,
      warnings: events.filter(e => (e.kind === 'console' || e.kind === 'log') && e.level === 'warning').length,
      failed: events.filter(e => e.kind === 'http' || e.kind === 'failed').length,
    };
  }

  function markdown({ title = '', expected = '', actual = '', steps = [], events = [], env = {}, shots = [] } = {}) {
    const s = summary(events);
    const time = env.time ? new Date(env.time).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '';
    const L = [`# ${title.trim() || 'Bug report'}`, ''];
    L.push('## Where', `- Page: ${env.title ? `${env.title} — ` : ''}${env.url || '—'}`, `- Browser: ${env.ua || '—'}`, `- Window: ${env.viewport || '—'}${env.dpr ? ` @${env.dpr}x` : ''} · language ${env.lang || '—'}${time ? ` · ${time}` : ''}`, '');
    L.push('## Steps to reproduce');
    if (steps.length) steps.forEach((st, i) => L.push(`${i + 1}. ${st.text}${shots.some(x => x.step === i) ? ` _(screenshot ${String(shots.find(x => x.step === i) ? shots.findIndex(x => x.step === i) + 1 : '').padStart(2, '0')})_` : ''}`));
    else L.push('_(no steps recorded)_');
    L.push('');
    if (expected.trim()) L.push('## Expected', expected.trim(), '');
    if (actual.trim()) L.push('## What happened instead', actual.trim(), '');
    L.push(`## What went wrong on the page (${s.errors} errors, ${s.warnings} warnings, ${s.failed} failed requests)`);
    const errs = events.filter(e => e.kind === 'exception' || e.kind === 'console' || e.kind === 'log');
    const net = events.filter(e => e.kind === 'http' || e.kind === 'failed');
    if (!errs.length && !net.length) L.push('_Nothing went wrong in the console or the network while recording._');
    if (errs.length) {
      L.push('', '### Console', '```');
      for (const e of errs.slice(0, 40)) L.push(fence(`[${e.kind === 'exception' ? 'uncaught' : e.level}] ${e.text}${e.url ? `  (${e.url}${e.line ? `:${e.line}` : ''})` : ''}`));
      L.push('```');
    }
    if (net.length) {
      L.push('', '### Failed requests', '| Status | Method | Address |', '| --- | --- | --- |');
      for (const e of net.slice(0, 40)) L.push(`| ${e.kind === 'http' ? e.status : e.error || 'failed'} | ${e.method || 'GET'} | ${String(e.url || '').replace(/\|/g, '%7C')} |`);
    }
    if (shots.length) L.push('', '## Screenshots', ...shots.map((x, i) => `- screenshots/${x.name} — after step ${x.step + 1}`));
    L.push('', '_Recorded with Mochi on this computer: field values, passwords and request bodies are never recorded._');
    return L.join('\n');
  }

  const forClaude = md => `Please help me find the cause of this bug and how to fix it. Here is what I recorded:\n\n${md}`;

  Mochi.bugReport = { markdown, forClaude, summary };
  if (typeof module !== 'undefined') module.exports = Mochi.bugReport;
})();
