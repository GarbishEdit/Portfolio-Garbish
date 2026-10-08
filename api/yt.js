// Fonction Vercel : vues d'une vidéo client + abonnés de sa chaîne, en direct.
// Appel : /api/yt?v=<id de la vidéo> (seules les vidéos listées ci-dessous sont acceptées).
// Sources, dans l'ordre :
//   1. API officielle YouTube si la variable d'environnement YOUTUBE_API_KEY existe ;
//   2. endpoint interne « next » de YouTube (celui qu'utilise youtube.com), sans clé ;
//   3. page publique de la vidéo.
// Réponse mise en cache 20 s côté Vercel.

const VIDEOS = {
  znUUv2CDoiE: 'UCv0hpXBfb0puNhwnzc9PjVQ', // Evann Chatraix — « Ils vous ont B*isé »
  NuYFnGlVFzA: 'UCD2bpNOOTJgwNejwaKG3DAA', // Léo Grindars — « La NOUVELLE ère des SaaS est arrivée »
};
const DEFAULT_VIDEO = 'znUUv2CDoiE';

// « 5.45 thousand subscribers », « 1.2 million subscribers », « 843 subscribers » → nombre
function parseCount(label) {
  const m = label && label.match(/([\d.,]+)\s*(thousand|million|K|M)?/i);
  if (!m) return NaN;
  const mult = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6 }[(m[2] || '').toLowerCase()] || 1;
  const n = mult > 1 ? parseFloat(m[1].replace(',', '')) : Number(m[1].replace(/[.,]/g, ''));
  return Math.round(n * mult);
}

function extract(text) {
  const views = text.match(/"videoViewCountRenderer":\{"viewCount":\{"simpleText":"([\d.,]+)/)
             || text.match(/"viewCount":"(\d+)"/);
  const subs  = text.match(/"subscriberCountText":\{"accessibility":\{"accessibilityData":\{"label":"([^"]+)"/);
  if (!views || !subs) return null;
  return { views: Number(views[1].replace(/[.,]/g, '')), subs: parseCount(subs[1]) };
}

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

async function fromInnertube(videoId) {
  const text = await fetch('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' } },
      videoId,
    }),
  }).then(r => r.text());
  const data = extract(text);
  if (!data) throw new Error('endpoint next illisible');
  return data;
}

async function fromPage(videoId) {
  const text = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: { 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'SOCS=CAI' },
  }).then(r => r.text());
  const data = extract(text);
  if (!data) throw new Error('page YouTube illisible');
  return data;
}

module.exports = async (req, res) => {
  const videoId = new URL(req.url, 'http://localhost').searchParams.get('v') || DEFAULT_VIDEO;
  if (!VIDEOS[videoId]) return res.status(400).json({ error: 'vidéo inconnue' });

  const key = process.env.YOUTUBE_API_KEY;
  const sources = [
    ...(key ? [['api', () => fromApi(key, videoId, VIDEOS[videoId])]] : []),
    ['next', () => fromInnertube(videoId)],
    ['page', () => fromPage(videoId)],
  ];
  const errors = [];
  for (const [name, get] of sources) {
    try {
      const data = await get();
      if (data.views > 0 && data.subs > 0) {
        res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
        return res.status(200).json({ ...data, source: name });
      }
      errors.push(`${name}: valeurs vides`);
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  res.status(502).json({ error: errors.join(' | ') });
};
