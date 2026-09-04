import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../hooks/useAuthStore.js';
import { listQueuedOps } from '../db/syncQueue.js';

export default function SyncStatus() {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.userId);
  const [pending, setPending] = useState(0);
  const [lastError, setLastError] = useState(null);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      listQueuedOps()
        .then((ops) => {
          if (!alive) return;
          setPending(ops.length);
          const failed = ops.find((o) => o.lastError) ?? null;
          setLastError(failed ? failed.lastError : null);
        })
        .catch(() => {});
    };
    refresh();
    const onFlushed = () => refresh();
    const onOnline = () => refresh();
    window.addEventListener('sync-flushed', onFlushed);
    window.addEventListener('online', onOnline);
    return () => {
      alive = false;
      window.removeEventListener('sync-flushed', onFlushed);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  const shortId = userId ? userId.slice(0, 8) : null;
  const status = lastError
    ? t('mainMenu.sync.failed', { error: lastError, defaultValue: `Sync failed: ${lastError}` })
    : pending > 0
      ? t('mainMenu.sync.pending', { count: pending, defaultValue: `Sync: ${pending} pending` })
      : t('mainMenu.sync.ok', { defaultValue: 'Sync: up to date' });

  return (
    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
      <div>{status}</div>
      {shortId && (
        <div>{t('mainMenu.sync.deviceId', { id: shortId, defaultValue: `Device sync ID: ${shortId}` })}</div>
      )}
    </div>
  );
}
