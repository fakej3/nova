/**
 * NOVA Shared Utilities
 * Pure helpers with no imports — safe to use everywhere.
 */

export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatRelativeTime(iso) {
  if (!iso) return '';
  const d    = new Date(iso);
  const diff = Date.now() - d;
  if (diff < 60_000)     return 'just now';
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Strip markdown syntax for plain-text card previews.
export function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/^#{1,3} /gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^- /gm, '· ')
    .replace(/\n/g, ' ')
    .trim();
}

// Render basic markdown to safe HTML (escape-first approach).
export function renderMarkdown(text) {
  if (!text) return '';
  let html = escHtml(text);
  html = html.replace(/^### (.+)$/gm, '<span class="md-h3">$1</span>');
  html = html.replace(/^## (.+)$/gm,  '<span class="md-h2">$1</span>');
  html = html.replace(/^# (.+)$/gm,   '<span class="md-h1">$1</span>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g,     '<em>$1</em>');
  html = html.replace(/`(.+?)`/g,       '<code class="md-code">$1</code>');
  html = html.replace(/^- (.+)$/gm,    '<span class="md-li">· $1</span>');
  html = html.replace(/\n/g, '<br>');
  return html;
}
