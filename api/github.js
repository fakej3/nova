const API_ROOT = 'https://api.github.com';

function cleanSegment(value, fallback='') {
  return String(value ?? fallback).trim().replace(/^\/+|\/+$/g, '');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const owner = cleanSegment(req.query?.owner);
  const repo = cleanSegment(req.query?.repo);
  const path = cleanSegment(req.query?.path);
  const ref = cleanSegment(req.query?.ref, 'master');

  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    res.status(400).json({ error: 'INVALID_REPOSITORY' });
    return;
  }
  if (path.includes('..') || ref.includes('..')) {
    res.status(400).json({ error: 'INVALID_PATH' });
    return;
  }

  try {
    const target = `${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`;
    const upstream = await fetch(target, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'wulan-nova',
      },
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: data?.message || `GITHUB_HTTP_${upstream.status}` });
      return;
    }

    if (Array.isArray(data)) {
      res.status(200).json({ type:'directory', owner, repo, path, ref, entries:data.map(item=>({name:item.name,path:item.path,type:item.type,size:item.size,sha:item.sha})) });
      return;
    }

    res.status(200).json({ type:'file', owner, repo, path, ref, name:data.name, size:data.size, sha:data.sha, htmlUrl:data.html_url, downloadUrl:data.download_url, encoding:data.encoding, content:data.encoding==='base64'?Buffer.from(data.content||'','base64').toString('utf8'):null });
  } catch (error) {
    console.error('[Wulan GitHub]', error);
    res.status(500).json({ error:'GITHUB_PROXY_ERROR' });
  }
}
