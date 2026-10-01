/**
 * Download a report from inside the Shopify admin. App Bridge adds the session token to fetch
 * calls to the app, so the export route stays authenticated (a plain link in a new tab wouldn't be).
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
