const SENTINEL_URL = 'https://sentinel-dz6kkg5ei-sentinel-lab.vercel.app';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const started = Date.now();
  try {
    const response = await fetch(SENTINEL_URL, { redirect: 'follow' });
    return res.status(200).json({
      service: 'Sentinel',
      deployment: SENTINEL_URL,
      reachable: response.ok,
      statusCode: response.status,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(502).json({
      service: 'Sentinel',
      deployment: SENTINEL_URL,
      reachable: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString(),
    });
  }
}
