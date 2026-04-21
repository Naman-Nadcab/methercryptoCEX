/**
 * Web Push notifications client helper.
 *
 * Flow:
 *  1. Browser support check (serviceWorker + PushManager).
 *  2. Request Notification permission (only on explicit user gesture).
 *  3. Register `/push-sw.js` at origin root.
 *  4. Subscribe with VAPID public key fetched from backend `/api/v1/push/vapid-key`.
 *  5. POST resulting subscription to backend `/api/v1/push/subscribe`.
 *
 * Works without Firebase / FCM — uses native Web Push with self-signed VAPID keys.
 */
import { getApiBaseUrl } from '@/lib/getApiUrl';

export interface PushStatus {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = typeof atob === 'function' ? atob(base64) : '';
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) return { supported: false, permission: 'unsupported', subscribed: false };
  const permission = Notification.permission;
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/push-sw.js');
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      subscribed = Boolean(sub);
    }
  } catch {}
  return { supported: true, permission, subscribed };
}

async function fetchVapidKey(): Promise<string> {
  const res = await fetch(`${getApiBaseUrl()}/api/v1/push/vapid-key`);
  const json = await res.json();
  if (!res.ok || !json?.data?.publicKey) throw new Error(json?.error?.message || 'Missing VAPID key');
  return json.data.publicKey as string;
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/push-sw.js');
  if (existing) return existing;
  return navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
}

export async function enablePushNotifications(accessToken: string): Promise<{ ok: boolean; error?: string }> {
  if (!isPushSupported()) return { ok: false, error: 'Browser does not support push notifications' };

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    return { ok: false, error: perm === 'denied' ? 'Notification permission denied' : 'Permission not granted' };
  }

  try {
    const reg = await registerServiceWorker();
    const vapidKey = await fetchVapidKey();

    // Reuse existing subscription if present.
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
    }

    const raw = sub.toJSON();
    const payload = {
      endpoint: raw.endpoint,
      keys: { p256dh: raw.keys?.p256dh, auth: raw.keys?.auth },
    };
    const res = await fetch(`${getApiBaseUrl()}/api/v1/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      return { ok: false, error: j?.error?.message || 'Subscribe failed' };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to enable push' };
  }
}

export async function disablePushNotifications(accessToken: string): Promise<{ ok: boolean; error?: string }> {
  if (!isPushSupported()) return { ok: true };
  try {
    const reg = await navigator.serviceWorker.getRegistration('/push-sw.js');
    if (!reg) return { ok: true };
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };

    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await fetch(`${getApiBaseUrl()}/api/v1/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to disable push' };
  }
}

export async function sendTestPush(accessToken: string): Promise<{ ok: boolean; error?: string; sent?: number; failed?: number }> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/v1/push/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: j?.error?.message || 'Test failed' };
    return { ok: true, sent: j?.data?.sent, failed: j?.data?.failed };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Test failed' };
  }
}
