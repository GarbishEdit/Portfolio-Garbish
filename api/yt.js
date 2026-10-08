// Fonction Vercel : vues d'une vidéo client + abonnés de sa chaîne, en direct.
// Appel : /api/yt?v=<id de la vidéo> (seules les vidéos listées ci-dessous sont acceptées).
// Avec une clé YOUTUBE_API_KEY (variable d'environnement Vercel) on passe par l'API officielle,
// sinon on lit la page publique de la vidéo. Réponse mise en cache 20 s côté Vercel.

const VIDEOS = {
  znUUv2CDoiE: 'UCv0hpXBfb0puNhwnzc9PjVQ', // Evann Chatraix — « Ils vous ont B*isé »
  NuYFnGlVFzA: 'UCD2bpNOOTJgwNejwaKG3DAA', // Léo Grindars — « La NOUVELLE ère des SaaS est arrivée »
};
const DEFAULT_VIDEO = 'znUUv2CDoiE';

async function fromApi(key, videoId, channelId) {
  const base = 'https://www.googleapis.com/youtube/v3';
  const [v, c] = await Promise.all([
    fetch(`${base}/videos?part=statistics&id=${videoId}&key=${key}`).then(r => r.json()),
    fetch(`${base}/channels?part=statistics&id=${channelId}&key=${key}`).then(r => r.json()),
  ]);
  return {
    views: Number(v.items[0].statistics.viewCount),
    subs:  Number(c.items[0].statistics.subscriberCount),
  };
}

async function fromPage(videoId) {
  const html = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: { 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'SOCS=CAI' },
  }).then(r => r.text());

  const views = html.match(/"viewCount":"(\d+)"/);
  // ex. "5.44 thousand subscribers", "1.2 million subscribers", "843 subscribers"
  const subs = html.match(/"subscriberCountText":\{"accessibility":\{"accessibilityData":\{"label":"([\d.,]+)\s*(thousand|million)?/);
  if (!views || !subs) throw new Error('page YouTube illisible');

  const mult = { thousand: 1e3, million: 1e6 }[subs[2]] || 1;
  return {
    views: Number(views[1]),
    subs:  Math.round(parseFloat(subs[1].replace(',', '')) * mult),
  };
}

module.exports = async (req, res) => {
  const videoId = new URL(req.url, 'http://localhost').searchParams.get('v') || DEFAULT_VIDEO;
  if (!VIDEOS[videoId]) return res.status(400).json({ error: 'vidéo inconnue' });
  try {
    const key  = process.env.YOUTUBE_API_KEY;
    const data = key ? await fromApi(key, videoId, VIDEOS[videoId]) : await fromPage(videoId);
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
