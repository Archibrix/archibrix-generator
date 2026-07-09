export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, logoBase64 } = req.body;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_KEY) return res.status(500).json({ error: 'API key not configured' });

  const result = { company: '', colors: '', suggestions: null, detail_reco: 'm', detail_reason: '', siteColors: [] };

  try {
    // 1. Fetch site content via Jina AI
    let siteContent = '';
    let siteColors = [];
    if (url) {
      try {
        const jinaResp = await fetch(`https://r.jina.ai/${url}`, {
          headers: { 'Accept': 'text/plain' }
        });
        if (jinaResp.ok) {
          const raw = await jinaResp.text();
          const hexes = [...new Set(raw.match(/#[0-9A-Fa-f]{6}/g) || [])];
          siteColors = hexes.filter(h => {
            const r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
            const diff = Math.max(r,g,b) - Math.min(r,g,b);
            return !(r>240&&g>240&&b>240) && !(r<15&&g<15&&b<15) && diff > 25;
          }).slice(0, 5);
          siteContent = raw.substring(0, 4000);
        }
      } catch(e) { /* Jina unavailable */ }
    }

    // 2. Analyze logo if provided
    let logoColors = '';
    let logoCompany = '';
    if (logoBase64) {
      try {
        const logoResp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
          body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 100,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: 'From this logo extract: 1) Company name (one word or brand name only) 2) Main brand colors in French (e.g. "vert fonce, blanc"). Respond ONLY as JSON: {"company":"name","colors":"color1, color2"}' },
                { type: 'image_url', image_url: { url: logoBase64 } }
              ]
            }]
          })
        });
        if (logoResp.ok) {
          const ld = await logoResp.json();
          const ltxt = ld.choices[0].message.content.trim().replace(/```json|```/g, '').trim();
          const ljson = JSON.parse(ltxt);
          logoCompany = ljson.company || '';
          logoColors = ljson.colors || '';
        }
      } catch(e) { /* Logo analysis failed */ }
    }

    // 3. Main GPT-4o analysis
    const colorHint = siteColors.length > 0
      ? `Hex colors from site (use ONLY these, do not invent): ${siteColors.join(', ')}`
      : logoColors ? `Brand colors from logo: ${logoColors}` : '';

    const context = siteContent
      ? `Site content for ${url}:\n\n${siteContent}\n\n${colorHint}`
      : `Website: ${url || 'unknown'}\n${colorHint}`;

    const prompt = `${context}

IMPORTANT: All label and desc fields must be in French. Short and clear. Respond ONLY as valid JSON without backticks:
{
  "company": "${logoCompany || 'exact company name'}",
  "colors": "${logoColors || (siteColors.length > 0 ? siteColors.slice(0,3).join(', ') : 'main brand colors in French')}",
  "suggestions": {
    "batiment": {
      "icon": "🏢",
      "label": "Nom court du batiment en francais ex: Siege Social ou Entrepot",
      "desc": "1 phrase courte en francais",
      "prompt": "ONE simple building or place: [describe only the essential structure, no surroundings, for a LEGO model of this company]",
      "search_query": "LEGO [building type] Creator Architecture"
    },
    "vehicule": {
      "icon": "🚚",
      "label": "Nom court du vehicule en francais ex: Camion de Livraison",
      "desc": "1 short sentence",
      "prompt": "ONE simple vehicle: [describe only the vehicle, for a LEGO model]",
      "search_query": "LEGO [vehicle type] Creator City"
    },
    "objet": {
      "icon": "🎾",
      "label": "Nom court de l objet en francais ex: Terrain de Padel ou Raquette - PAS de description en anglais",
      "desc": "1 phrase courte en francais - ex pour Padelstay: Un terrain de padel miniature aux couleurs de la marque",
      "prompt": "ONE simple object: [the most iconic single object of this company activity, nothing else]",
      "search_query": "LEGO [object type] set"
    },
    "scene": {
      "icon": "🎬",
      "label": "Nom court de la scene en francais ex: Scene de Chantier",
      "desc": "1 short sentence",
      "prompt": "Simple scene with maximum 3 LEGO elements: [describe minimal scene]",
      "search_query": "LEGO [scene type] diorama MOC"
    }
  },
  "detail_reco": "s",
  "detail_reason": "1 short sentence explaining why this complexity is recommended for this specific kit"
}`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] })
    });

    if (!r.ok) throw new Error('GPT API error');
    const d = await r.json();
    const txt = d.choices[0].message.content.trim().replace(/```json|```/g, '').trim();
    const json = JSON.parse(txt);

    return res.status(200).json({ ...json, siteColors });

  } catch(e) {
    return res.status(200).json({ ...result, error: e.message });
  }
}
