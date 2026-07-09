export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return res.status(500).json({ error: 'API key not configured' });

  const { kit, company, colors, detail, refImgBase64, variation } = req.body;

  const DETAIL_MAP = {
    xs: '80 to 150',
    s:  '150 to 250',
    m:  '250 to 450',
    l:  '450 to 800'
  };
  const pieces = DETAIL_MAP[detail] || DETAIL_MAP['m'];

  // Subject
  let subject = '';
  if (kit?.isAutre) {
    subject = `${kit.autreObj || 'custom object'} in ${kit.autreCol || colors || 'brand colors'} with ${kit.autreLogo || company || ''} branding`;
  } else if (kit?.isAI && kit?.prompt) {
    subject = kit.prompt;
  } else {
    subject = `${kit?.label || 'professional object'} for ${company || 'a company'}`;
  }

  const angleNote = variation === 0
    ? 'Front isometric view, centered and symmetrical.'
    : '3/4 front-right view, slightly above eye level, showing depth.';

  // ── PROMPT ────────────────────────────────────────────────────────────────
  const prompt =
    `Transform the subject into an official LEGO brick model product photograph. ` +
    `Subject to reproduce in LEGO: ${subject}. ` +
    (colors ? `Use these exact brick colors: ${colors}. ` : '') +
    (company ? `Add a small white LEGO tile with "${company}" printed text on the front base. ` : '') +
    `Build approximately ${pieces} LEGO bricks total. ` +
    `STRICT RULES: ` +
    `Every surface must show clearly visible round cylindrical LEGO studs. ` +
    `All shapes made exclusively from rectangular interlocking LEGO bricks with 90-degree edges. ` +
    `Use real LEGO piece types: standard bricks, plates, slopes, tiles, transparent pieces for windows. ` +
    `Shiny ABS plastic material. No smooth surfaces without studs. No organic curves. No impossible connections. ` +
    `Keep it simple — ONE main object, remove all people, trees, cars, furniture, decoration. ` +
    (colors ? `Border bricks around the grey baseplate must be ${colors.split(/[,&]/)[0].trim()} colored. ` : '') +
    `${angleNote} ` +
    `PHOTOGRAPHY: official LEGO Creator Expert product photograph. ` +
    `Real toy photography — NOT CGI, NOT Blender, NOT concept art. ` +
    `Pure white seamless studio background. Soft diffused lighting. Gentle drop shadow. ` +
    `The result must look exactly like a real physical LEGO toy photographed in a studio.`;

  try {
    let imageUrl = null;

    if (refImgBase64) {
      // ── MODE IMAGE+TEXTE via images/edits ─────────────────────────────────
      // Convertir base64 en blob pour FormData
      const base64Data = refImgBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      const FormData = (await import('formdata-node')).FormData;
      const { Blob } = await import('buffer');

      const form = new FormData();
      form.append('model', 'gpt-image-1');
      form.append('prompt', prompt);
      form.append('n', '1');
      form.append('size', '1024x1024');
      form.append('quality', 'high');
      form.append('image[]', new Blob([buffer], { type: 'image/png' }), 'reference.png');

      const r = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: form
      });

      if (!r.ok) {
        const er = await r.json();
        // Fallback to generations if edits fails
        console.log('Edits failed, falling back to generations:', er.error?.message);
        const r2 = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
          body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1024x1024', quality: 'high' })
        });
        if (!r2.ok) { const e2 = await r2.json(); throw new Error(e2.error?.message || 'Generation failed'); }
        const d2 = await r2.json();
        imageUrl = d2.data[0].url || `data:image/png;base64,${d2.data[0].b64_json}`;
      } else {
        const d = await r.json();
        imageUrl = d.data[0].url || `data:image/png;base64,${d.data[0].b64_json}`;
      }

    } else {
      // ── MODE TEXTE SEUL ───────────────────────────────────────────────────
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1024x1024', quality: 'high' })
      });
      if (!r.ok) { const er = await r.json(); throw new Error(er.error?.message || 'Generation failed'); }
      const d = await r.json();
      imageUrl = d.data[0].url || `data:image/png;base64,${d.data[0].b64_json}`;
    }

    return res.status(200).json({ url: imageUrl, prompt });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
