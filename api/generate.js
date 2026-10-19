// api/generate.js — BrixGPT, génération d'image (fonction serverless Vercel)
//
// Variables d'environnement Vercel (Settings → Environment Variables) :
//   OPENAI_API_KEY   obligatoire, jamais dans le code
//   IMAGE_MODEL      optionnel, défaut "gpt-image-2.5-flare"
//   IMAGE_QUALITY    optionnel, défaut "high"
//   STYLE_REF_URLS   optionnel, URLs de vrais rendus Archibrix séparées par des virgules
//                    (ex. https://archibrix-generator.vercel.app/style/ref1.jpg,...)
//
// Contrat inchangé avec index.html : on reçoit { kit, company, colors, detail, refImgBase64, variation }
// et on renvoie { url }. Champs en plus, optionnels : logoBase64, model (pour la page de comparaison).

const ALLOWED_MODELS = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-1'];
const DEFAULT_MODEL = ALLOWED_MODELS.includes(process.env.IMAGE_MODEL) ? process.env.IMAGE_MODEL : 'gpt-image-2.5-flare';
const QUALITY = process.env.IMAGE_QUALITY || 'high';
const STYLE_REF_URLS = (process.env.STYLE_REF_URLS || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);

const PIECES = { xs: '80 to 150', s: '150 to 250', m: '250 to 450', l: '450 to 800' };

function clean(v, max = 200) {
  return String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function dataUrlToBlob(input) {
  if (!input) return null;
  const m = /^data:(image\/[\w+.-]+);base64,(.+)$/s.exec(input);
  const type = m ? m[1] : 'image/png';
  const b64 = m ? m[2] : input;
  try { return new Blob([Buffer.from(b64, 'base64')], { type }); } catch { return null; }
}

async function urlToBlob(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Référence de style introuvable : ${url}`);
  return new Blob([await r.arrayBuffer()], { type: r.headers.get('content-type') || 'image/jpeg' });
}

function buildPrompt({ subject, company, colors, pieces, variation, slots }) {
  const lines = [];

  // Rôle de chaque image, numérotée comme le recommande la doc OpenAI
  if (slots.ref) lines.push(`Image ${slots.ref} is the client's reference photo. It is the subject to rebuild: keep its silhouette, proportions, colors and distinctive features clearly recognizable.`);
  if (slots.logo) lines.push(`Image ${slots.logo} is the client's logo. Print it once, small, on a single flat tile on the front border of the baseplate. Do not place it anywhere else.`);
  if (slots.style.length) lines.push(`Image${slots.style.length > 1 ? 's' : ''} ${slots.style.join(', ')} ${slots.style.length > 1 ? 'are photos' : 'is a photo'} of real Archibrix brick kits. Match their photographic style, lighting, brick vocabulary and level of detail. Do not copy their subjects.`);

  lines.push(`Rebuild the subject as a buildable brick model made of LEGO-compatible bricks, about ${pieces} pieces. Subject: ${subject}.`);
  if (colors) lines.push(`Use these brick colors: ${colors}. The border bricks around the grey baseplate are ${colors.split(/[,&]/)[0].trim()}.`);
  if (company && !slots.logo) lines.push(`Add one small white flat tile on the front border of the baseplate with "${company}" printed on it.`);

  lines.push(
    'Brick rules: every top surface shows round studs; shapes come only from real brick, plate, slope and tile pieces with 90-degree edges; transparent pieces for windows; glossy ABS plastic; no smooth sculpted surfaces; no organic curves.',
    'One main object only: no people, trees, extra vehicles, furniture or scenery.',
    'No LEGO logo or any other brand marking on studs, bricks or background. No text other than the client tile.',
    variation === 0
      ? 'Camera: front isometric view, centered and symmetrical.'
      : 'Camera: three-quarter front-right view, slightly above eye level, showing depth.',
    'Photography: real physical toy product photo, not CGI or illustration. Pure white seamless studio background, soft diffused light, gentle drop shadow.'
  );
  return lines.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.OPENAI_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'Clé API non configurée sur le serveur' });

  const body = req.body || {};
  const model = ALLOWED_MODELS.includes(body.model) ? body.model : DEFAULT_MODEL;
  const company = clean(body.company, 60);
  const colors = clean(body.colors, 80);
  const pieces = PIECES[body.detail] || PIECES.m;
  const variation = body.variation === 0 ? 0 : 1;

  const kit = body.kit || {};
  let subject;
  if (kit.isAutre) subject = `${clean(kit.autreObj) || 'custom object'} in ${clean(kit.autreCol) || colors || 'brand colors'}`;
  else if (kit.isAI && kit.prompt) subject = clean(kit.prompt, 400);
  else subject = `${clean(kit.label) || 'professional object'} for ${company || 'a company'}`;

  try {
    // Assemblage des images d'entrée : photo client, logo, puis références de style
    const images = [];
    const slots = { ref: 0, logo: 0, style: [] };
    const ref = dataUrlToBlob(body.refImgBase64);
    if (ref) { images.push(ref); slots.ref = images.length; }
    const logo = dataUrlToBlob(body.logoBase64);
    if (logo) { images.push(logo); slots.logo = images.length; }
    for (const u of STYLE_REF_URLS) { images.push(await urlToBlob(u)); slots.style.push(images.length); }

    const prompt = buildPrompt({ subject, company, colors, pieces, variation, slots });
    const t0 = Date.now();
    let r;

    if (images.length) {
      const fd = new FormData();
      fd.append('model', model);
      fd.append('prompt', prompt);
      fd.append('n', '1');
      fd.append('size', '1024x1024');
      fd.append('quality', QUALITY);
      if (model === 'gpt-image-1') fd.append('input_fidelity', 'high');
      images.forEach((b, i) => fd.append('image[]', b, `image-${i + 1}.${(b.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`));
      r = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}` },
        body: fd
      });
    } else {
      r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024', quality: QUALITY })
      });
    }

    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Plus de bascule silencieuse vers le texte seul : si la photo n'est pas prise en compte, on veut le savoir
      console.error('OpenAI error', model, r.status, d.error?.message);
      return res.status(r.status).json({ error: d.error?.message || 'Erreur OpenAI', model });
    }

    const img = d.data?.[0];
    const url = img?.url || (img?.b64_json ? `data:image/png;base64,${img.b64_json}` : null);
    if (!url) return res.status(502).json({ error: 'Réponse OpenAI sans image', model });

    return res.status(200).json({ url, model, ms: Date.now() - t0, usage: d.usage || null, prompt });
  } catch (e) {
    console.error('generate failed', model, e);
    return res.status(500).json({ error: e.message, model });
  }
}
