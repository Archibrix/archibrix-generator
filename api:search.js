export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query, type } = req.body;
  const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;

  // LEGO style descriptions by object type — used when no image found
  const LEGO_STYLE_REFS = {
    batiment: "LEGO Architecture set style: white and light grey bricks, flat roof tiles, transparent blue window pieces, green baseplate, minimal decoration, clean geometric shapes",
    vehicule: "LEGO City vehicle style: solid colored rectangular bricks, black wheels, transparent windscreen, compact blocky shape, stud details on hood",
    objet: "LEGO Creator Expert style: detailed brick construction, multiple colors, visible stud texture, display model on grey baseplate",
    scene: "LEGO Creator 3-in-1 diorama style: green baseplate, simple background elements, 2-3 main objects, clear composition",
    default: "Official LEGO set style: visible studs, rectangular bricks, ABS plastic sheen, clean studio photography"
  };

  try {
    // Try Unsplash first for photo reference
    let photoUrl = null;
    let photoDesc = null;

    if (UNSPLASH_KEY && query) {
      const unsplashResp = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
        { headers: { 'Authorization': `Client-ID ${UNSPLASH_KEY}` } }
      );
      if (unsplashResp.ok) {
        const ud = await unsplashResp.json();
        if (ud.results && ud.results.length > 0) {
          photoUrl = ud.results[0].urls.regular;
          photoDesc = ud.results[0].alt_description || query;
        }
      }
    }

    // Return both photo URL and style description
    return res.status(200).json({
      photoUrl,
      photoDesc,
      styleRef: LEGO_STYLE_REFS[type] || LEGO_STYLE_REFS.default,
      searchQuery: query
    });

  } catch(e) {
    return res.status(200).json({
      photoUrl: null,
      styleRef: LEGO_STYLE_REFS[type] || LEGO_STYLE_REFS.default,
      error: e.message
    });
  }
}
