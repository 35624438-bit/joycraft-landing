export default async function handler(req, res) {
  const health = { status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() };

  // UCloud connectivity check
  let ucloud = 'unknown';
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const r = await fetch(`${process.env.UCLOUD_API_BASE || 'https://api-sg.umodelverse.ai'}/v1/models`, {
      headers: { 'Authorization': `Bearer ${process.env.UCLOUD_API_KEY}` },
      signal: c.signal,
    });
    clearTimeout(t);
    ucloud = r.ok ? 'healthy' : 'degraded';
  } catch { ucloud = 'unreachable'; }
  health.ucloud = ucloud;

  return res.status(200).json(health);
}
