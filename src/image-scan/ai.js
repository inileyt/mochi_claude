/*
 * Mochi — Image Scan: "what the image shows", with Chrome's built-in on-device model
 * (the Prompt API, Gemini Nano). Runs in the offscreen worker page; the image never
 * leaves the computer. When Chrome has no such model (or the computer can't run it),
 * this quietly says "unavailable" and the card offers "Ask Claude" instead.
 *
 *   await Mochi.imageAi.status()   → { available: 'available'|'downloadable'|'downloading'|'unavailable' }
 *   await Mochi.imageAi.describe(canvas) → { available, description?: { subject, objects, setting, style,
 *                                             lighting, mood, composition, camera, caption } }
 * The model is downloaded only from pages/ai-model.html, after the user says yes (Chrome
 * also needs a click there to start a download).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  const TIMEOUT_MS = 90000;
  const OPTIONS = {
    expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  };
  const FIELDS = ['subject', 'objects', 'setting', 'style', 'lighting', 'mood', 'composition', 'camera', 'caption'];
  const SCHEMA = {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'The main subject, in a few words' },
      objects: { type: 'array', items: { type: 'string' }, maxItems: 12, description: 'Other visible things' },
      setting: { type: 'string', description: 'Where it is: place, background, time of day' },
      style: { type: 'string', description: 'Style or medium: photo, 3D render, flat illustration, pixel art, watercolor, poster, screenshot…' },
      lighting: { type: 'string' },
      mood: { type: 'string' },
      composition: { type: 'string', description: 'Framing and layout: centered, rule of thirds, close-up, wide…' },
      camera: { type: 'string', description: 'Camera angle / point of view: eye level, top-down, low angle…' },
      caption: { type: 'string', description: 'One sentence describing the image' },
    },
    required: FIELDS,
    additionalProperties: false,
  };
  const PROMPT = 'Describe this image for someone who wants to recreate its look. Answer in English, briefly, with the fields of the JSON schema. Do not guess names of real people. If there is text in the image, mention that there is text but do not transcribe it.';

  const api = () => globalThis.LanguageModel;

  async function status() {
    const LM = api();
    if (!LM?.availability) return { available: 'unavailable', reason: 'no-api' };
    try { return { available: await LM.availability(OPTIONS) }; } catch (err) { return { available: 'unavailable', reason: String(err?.message || err).slice(0, 120) }; }
  }

  const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  function normalize(raw) {
    const d = typeof raw === 'string' ? JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) : raw;
    const out = {};
    for (const f of FIELDS) out[f] = f === 'objects' ? (Array.isArray(d?.objects) ? d.objects.map(o => clean(o, 60)).filter(Boolean).slice(0, 12) : []) : clean(d?.[f], f === 'caption' ? 300 : 200);
    if (!out.subject && !out.caption) throw new Error('empty-description');
    return out;
  }

  /** The image for the model: an ImageBitmap of the canvas, at most 1024 px. */
  async function imageFor(canvas) {
    const f = Math.min(1, 1024 / Math.max(canvas.width, canvas.height));
    return createImageBitmap(canvas, { resizeWidth: Math.max(1, Math.round(canvas.width * f)), resizeHeight: Math.max(1, Math.round(canvas.height * f)), resizeQuality: 'high' });
  }

  async function describe(canvas, { onProgress = () => {} } = {}) {
    const { available } = await status();
    if (available !== 'available') return { available };
    const LM = api();
    let session = null;
    try {
      session = await LM.create({ ...OPTIONS, monitor: m => m.addEventListener?.('downloadprogress', e => onProgress(e.loaded || 0)) });
      const image = await imageFor(canvas);
      const answer = await Promise.race([
        session.prompt([{ role: 'user', content: [{ type: 'text', value: PROMPT }, { type: 'image', value: image }] }], { responseConstraint: SCHEMA }),
        new Promise((_, no) => setTimeout(() => no(new Error('ai-timeout')), TIMEOUT_MS)),
      ]);
      image.close?.();
      return { available, description: normalize(answer), model: 'on-device' };
    } catch (err) {
      return { available, error: String(err?.message || err).slice(0, 160) };
    } finally {
      try { session?.destroy?.(); } catch (_) { /* gone already */ }
    }
  }

  Mochi.imageAi = { status, describe, normalize, SCHEMA, OPTIONS, PROMPT, FIELDS };
  if (typeof module !== 'undefined') module.exports = Mochi.imageAi;
})();
