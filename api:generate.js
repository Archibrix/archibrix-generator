export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return res.status(500).json({ error: 'API key not configured' });

  const { kit, company, colors, detail, refVisionDesc, styleRef, variation } = req.body;

  // ── PIECE COUNTS BY DETAIL ────────────────────────────────────────────────
  const DETAIL_MAP = {
    xs: { pieces: '80 to 150', label: 'Simple' },
    s:  { pieces: '150 to 250', label: 'Standard' },
    m:  { pieces: '250 to 450', label: 'Detailed' },
    l:  { pieces: '450 to 800', label: 'Premium' }
  };
  const dm = DETAIL_MAP[detail] || DETAIL_MAP['m'];

  // ── SPECIALIZED PROMPT TEMPLATES ─────────────────────────────────────────
  const TEMPLATES = {
    batiment: (subject, pieces, colors, company) =>
      `A single custom LEGO building model: ${subject}. `+
      `Approximately ${pieces} LEGO bricks. `+
      `Architecture: flat or slightly sloped roof made of LEGO tile pieces, `+
      `rectangular walls built with standard LEGO bricks, `+
      `transparent LEGO window pieces (blue or clear), `+
      `thin LEGO plate layers for floors. `+
      `Base: grey or dark grey LEGO baseplate with ${colors} colored border bricks as frame. `,

    vehicule: (subject, pieces, colors, company) =>
      `A single custom LEGO vehicle model: ${subject}. `+
      `Approximately ${pieces} LEGO bricks. `+
      `Vehicle shape: blocky rectangular LEGO brick construction, `+
      `black LEGO wheel arches and tires, `+
      `transparent LEGO windscreen piece, `+
      `${colors} colored body panels made of LEGO bricks. `+
      `On a small LEGO grey display base. `,

    objet: (subject, pieces, colors, company) =>
      `A single custom LEGO object model: ${subject}. `+
      `Approximately ${pieces} LEGO bricks. `+
      `Simple iconic shape using standard LEGO brick geometry, `+
      `${colors} colored bricks, `+
      `displayed on a thin LEGO grey baseplate. `,

    scene: (subject, pieces, colors, company) =>
      `A simple LEGO diorama scene: ${subject}. `+
      `Maximum 3 main elements. Approximately ${pieces} LEGO bricks total. `+
      `Green LEGO baseplate ground, `+
      `${colors} colored main elements, `+
      `clean minimal composition. `,

    default: (subject, pieces, colors, company) =>
      `A single custom LEGO model: ${subject}. `+
      `Approximately ${pieces} LEGO bricks. `+
      `${colors} colored bricks. `
  };

  const type = kit?.type || 'default';
  const subject = kit?.isAutre
    ? `${kit.autreObj || 'custom object'} in ${kit.autreCol || colors} with ${kit.autreLogo || company} branding`
    : kit?.isAI && kit?.prompt ? kit.prompt : kit?.label || 'custom professional object';

  const template = TEMPLATES[type] || TEMPLATES.default;
  const baseDesc = template(subject, dm.pieces, colors || 'brand', company || '');

  // ── BUILD FINAL PROMPT ───────────────────────────────────────────────────
  const angleNote = variation === 0
    ? 'Camera: front isometric view, centered, symmetrical composition.'
    : 'Camera: 3/4 front-right view, slightly above eye level, showing model depth.';

  let prompt = '';

  // Reference context
  if (refVisionDesc) {
    prompt += `Visual reference analysis: ${refVisionDesc} `;
    prompt += `Use this ONLY to understand the subject shape and proportions. `;
  }
  if (styleRef) {
    prompt += `LEGO style reference: ${styleRef} `;
  }

  // Main description
  prompt += baseDesc;

  // Company branding
  if (company) {
    prompt += `Include one small white LEGO 1x4 tile with "${company}" text printed in ${colors?.split(/[,&]/)[0]?.trim() || 'brand color'} on the front base border. `;
  }

  // LEGO construction rules
  prompt += `STRICT LEGO CONSTRUCTION RULES: `;
  prompt += `(1) Every brick surface must show clearly visible round cylindrical LEGO studs. `;
  prompt += `(2) All shapes built from rectangular interlocking LEGO bricks only — sharp 90-degree edges. `;
  prompt += `(3) Use real LEGO piece types: bricks, plates, slopes, tiles, transparent pieces for windows. `;
  prompt += `(4) No smooth surfaces without studs. No organic curves. No impossible connections. `;
  prompt += `(5) Shiny ABS plastic material — the typical LEGO plastic appearance. `;
  prompt += `(6) REMOVE ALL: people, trees, cars, furniture, decoration, small accessories. Keep ONLY the essential iconic shape. `;
  prompt += `(7) ${colors} colored border bricks frame the grey baseplate. `;

  // Photography
  prompt += `PHOTOGRAPHY: Official LEGO set product photograph. `;
  prompt += `Real toy photography — NOT CGI, NOT Blender, NOT concept art, NOT digital illustration. `;
  prompt += `Pure white seamless studio background. Soft diffused studio lighting. Gentle drop shadow. `;
  prompt += `${angleNote} `;
  prompt += `Style: LEGO Creator Expert or LEGO Architecture official set box photograph. `;
  prompt += `The final result must look exactly like a real physical LEGO toy photographed in a studio.`;

  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'high'
      })
    });

    if (!r.ok) {
      const er = await r.json();
      throw new Error(er.error?.message || 'Image generation failed');
    }

    const d = await r.json();
    const imageData = d.data[0];
    const imageUrl = imageData.url || `data:image/png;base64,${imageData.b64_json}`;

    return res.status(200).json({ url: imageUrl, prompt });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
