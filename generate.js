export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return res.status(500).json({ error: 'API key not configured' });

  const { kit, company, colors, detail, refImgBase64, variation } = req.body;

  const DETAIL_MAP = {
    xs: '80 to 150', s: '150 to 250', m: '250 to 450', l: '450 to 800'
  };
  const pieces = DETAIL_MAP[detail] || DETAIL_MAP['m'];

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

  const prompt =
    `Transform the reference image into an official LEGO brick model. ` +
    `Subject: ${subject}. ` +
    (colors ? `Use these exact brick colors: ${colors}. ` : '') +
    (company ? `Add a small white LEGO tile with "${company}" printed text on the front base border. ` : '') +
    `Build approximately ${pieces} LEGO bricks total. ` +
    `STRICT LEGO RULES: ` +
    `Every surface must show clearly visible round cylindrical LEGO studs. ` +
    `All shapes made exclusively from rectangular interlocking LEGO bricks with 90-degree edges. ` +
    `Use real LEGO piece types: bricks, plates, slopes, tiles, transparent pieces for windows. ` +
    `Shiny ABS plastic material. No smooth surfaces without studs. No organic curves. ` +
    `Keep it simple — ONE main object, remove all people, trees, cars, furniture, background decoration. ` +
    (colors ? `Border bricks around the grey baseplate must be ${colors.split(/[,&]/)[0].trim()} colored. ` : '') +
    `${angleNote} ` +
    `PHOTOGRAPHY: official LEGO Creator Expert product photograph. ` +
    `Real toy photography — NOT CGI, NOT Blender, NOT concept art. ` +
    `Pure white seamless studio background. Soft diffused lighting. Gentle drop shadow. ` +
    `The result must look exactly like a real physical LEGO toy photographed in a studio.`;

  try {
    let imageUrl = null;

    if (refImgBase64) {
      // Utiliser images/edits avec multipart/form-data natif Node.js
      const base64Data = refImgBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);

      const buildPart = (name, value, filename, contentType) => {
        let part = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"`;
        if (filename) part += `; filename="${filename}"`;
        part += '\r\n';
        if (contentType) part += `Content-Type: ${contentType}\r\n`;
        part += '\r\n';
        return part;
      };

      const textEncoder = new TextEncoder();
      const parts = [];

      // model
      parts.push(Buffer.from(buildPart('model') + 'gpt-image-1\r\n'));
      // prompt
      parts.push(Buffer.from(buildPart('prompt') + prompt + '\r\n'));
      // n
      parts.push(Buffer.from(buildPart('n') + '1\r\n'));
      // size
      parts.push(Buffer.from(buildPart('size') + '1024x1024\r\n'));
      // quality
      parts.push(Buffer.from(buildPart('quality') + 'high\r\n'));
      // image
      parts.push(Buffer.from(buildPart('image[]', null, 'reference.png', 'image/png')));
      parts.push(buffer);
      parts.push(Buffer.from('\r\n'));
      // close
      parts.push(Buffer.from(`--${boundary}--\r\n`));

      const body = Buffer.concat(parts);

      const r = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length.toString()
        },
        body
      });

      if (!r.ok) {
        const er = await r.json();
        console.log('Edits failed:', er.error?.message, '— falling back to generations');
        // Fallback: generation texte seule
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
      // Pas de photo — generation texte seule
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
