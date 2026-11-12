/** Pure helpers for automatic backups and the "last backup" status line. No chrome APIs, so they're unit-testable. */

export const AUTO_BACKUP_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000; // at most about once a day
export const STALE_BACKUP_MS = 7 * 24 * 60 * 60 * 1000;

/** Cheap, stable string hash (djb2). Only used to tell "data changed since the last backup". */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export interface AutoBackupState {
  at: number; // when the last automatic backup was written
  hash: string; // hash of the data it contained
  error?: string; // set when the last attempt failed
}

export function shouldAutoBackup(o: {
  now: number;
  enabled: boolean;
  hasData: boolean;
  hash: string;
  last: AutoBackupState | undefined;
}): boolean {
  if (!o.enabled || !o.hasData) return false;
  if (!o.last) return true;
  if (o.last.error && o.now - o.last.at > 60 * 60 * 1000) return true; // retry failures hourly
  if (o.last.hash === o.hash) return false; // nothing new to protect
  return o.now - o.last.at >= AUTO_BACKUP_MIN_INTERVAL_MS;
}

export function backupFilename(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const d = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  return `Commander Cart Tagger backups/commander-cart-tagger-${d}.json`;
}

/** data: URL for chrome.downloads (service workers have no URL.createObjectURL). */
export function backupDataUrl(json: string): string {
  return "data:application/json;charset=utf-8," + encodeURIComponent(json);
}

export function ago(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export interface BackupStatus {
  text: string;
  level: "ok" | "warn";
}

/** What the panel footer says about backups. */
export function backupStatus(o: {
  now: number;
  hasData: boolean;
  autoEnabled: boolean;
  manualAt?: number;
  auto?: AutoBackupState;
}): BackupStatus {
  const autoAt = o.auto && !o.auto.error ? o.auto.at : undefined;
  const newest = Math.max(autoAt ?? 0, o.manualAt ?? 0) || undefined;
  const parts: string[] = [];
  if (autoAt) parts.push(`auto ${ago(o.now - autoAt)}`);
  if (o.manualAt) parts.push(`manual ${ago(o.now - o.manualAt)}`);
  if (o.auto?.error) parts.push(`auto backup failed: ${o.auto.error}`);

  if (!o.hasData) return { text: "Nothing to back up yet.", level: "ok" };
  if (!newest) {
    if (o.auto?.error) return { text: `Automatic backup failed (${o.auto.error}). Use Export data.`, level: "warn" };
    return {
      text: o.autoEnabled ? "No backup yet. One will be saved to Downloads after your next change." : "No backup yet. Use Export data.",
      level: "warn",
    };
  }
  const stale = o.now - newest > STALE_BACKUP_MS;
  const text = `Last backup: ${parts.join(" · ")}${stale ? ". Over a week old, so consider exporting." : ""}`;
  return { text, level: stale || !!o.auto?.error ? "warn" : "ok" };
}
