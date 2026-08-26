const BRANCH_ADDRESSES = Object.freeze({
  'kuching-satok': 'LOT 442, Ground Floor Section 11, KTLD, Jln Kulas, Kampung Bandarshah, 93400 Kuching, Sarawak',
  'kota-samarahan': 'SL No.10 Lots 2280 & 3792, MTLD Desa Ilmu Commercial Kota Samarahan, 94300 Kuching, Sarawak',
  'kuching-batu-kawa': 'Ground Floor, Sublot 2, 15 Shoppe, Jalan Batu Kawa, Taman Desa Wira, 93250 Kuching, Sarawak',
  bintulu: 'Unit No. A-L1-11, SK One Garden City, Jln Sultan Iskandar, 97000 Bintulu, Sarawak',
  'petaling-jaya': '15, Ground Floor 10th Mile, Lebuhraya Persekutuan, Sungai Way Free Trade Industrial Zone, 47300 Petaling Jaya, Selangor'
});

export function navigationDestination({ branch = '', provider = '' } = {}) {
  const address = BRANCH_ADDRESSES[String(branch || '').trim().toLowerCase()];
  const app = String(provider || '').trim().toLowerCase();
  if (!address || !['maps', 'waze'].includes(app)) return '';
  const query = encodeURIComponent(address);
  return app === 'maps'
    ? `https://www.google.com/maps/search/?api=1&query=${query}`
    : `https://waze.com/ul?q=${query}&navigate=yes`;
}

export default function handler(req, res) {
  const destination = navigationDestination(req.query || {});
  if (!destination) {
    res.status(404).json({ error: 'Branch navigation link not found' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.redirect(302, destination);
}

