export const NOTIFICATIONS_ENABLED_LOCALSTORAGE_KEY = 'LlamaCppWebui.notificationsEnabled';

export type NotificationPermissionStatus = NotificationPermission | 'unsupported';

export type NotificationEnvironmentSnapshot = {
  userAgent: string;
  secureContext: boolean;
  notificationApiPresent: boolean;
  notificationPermission: NotificationPermissionStatus;
  serviceWorkerSupported: boolean;
  documentVisibility: DocumentVisibilityState | 'n/a';
  documentHasFocus: boolean;
  notificationsEnabledPref: string;
};

export type NotificationServiceWorkerDescription = {
  supported: boolean;
  existingScope?: string | null;
  existingActive?: string | null;
  existingState?: string | null;
  readyResolved?: boolean;
  readyScope?: string | null;
  readyActive?: string | null;
  readyState?: string | null;
  showNotificationAvailable?: boolean;
  error?: string;
};

export type NotificationPayload = {
  title: string;
  body: string;
  tag: string;
  url?: string;
};

export function isNotificationApiSupported() {
  return typeof window !== 'undefined' && typeof Notification !== 'undefined';
}

export function isPushManagerSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof PushManager !== 'undefined'
  );
}

export function getNotificationPermission(): NotificationPermission | null {
  return isNotificationApiSupported() ? Notification.permission : null;
}

export function readNotificationsEnabledPreference() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(NOTIFICATIONS_ENABLED_LOCALSTORAGE_KEY) === '1';
}

export function readNotificationsEnabledPreferenceValue() {
  if (typeof window === 'undefined') {
    return '0';
  }

  return window.localStorage.getItem(NOTIFICATIONS_ENABLED_LOCALSTORAGE_KEY) ?? '(unset)';
}

export function writeNotificationsEnabledPreference(enabled: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(NOTIFICATIONS_ENABLED_LOCALSTORAGE_KEY, enabled ? '1' : '0');
}

export function readNotificationEnvironmentSnapshot(): NotificationEnvironmentSnapshot {
  if (typeof window === 'undefined') {
    return {
      userAgent: 'n/a (SSR)',
      secureContext: false,
      notificationApiPresent: false,
      notificationPermission: 'unsupported',
      serviceWorkerSupported: false,
      documentVisibility: 'n/a',
      documentHasFocus: false,
      notificationsEnabledPref: '0'
    };
  }

  return {
    userAgent: window.navigator.userAgent,
    secureContext: window.isSecureContext,
    notificationApiPresent: isNotificationApiSupported(),
    notificationPermission: getNotificationPermission() ?? 'unsupported',
    serviceWorkerSupported: 'serviceWorker' in navigator,
    documentVisibility: document.visibilityState,
    documentHasFocus: document.hasFocus(),
    notificationsEnabledPref: readNotificationsEnabledPreferenceValue()
  };
}

export async function getNotificationServiceWorkerRegistration(timeoutMs = 1500) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  const existing = await navigator.serviceWorker.getRegistration();
  if (existing && typeof existing.showNotification === 'function') {
    return existing;
  }

  const ready = await Promise.race<ServiceWorkerRegistration | null>([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs))
  ]);
  if (ready && typeof ready.showNotification === 'function') {
    return ready;
  }

  return null;
}

function decodeUrlSafeBase64(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const raw = window.atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

export async function getBrowserPushSubscription(timeoutMs = 1500) {
  if (!isPushManagerSupported()) {
    return null;
  }

  const registration = await getNotificationServiceWorkerRegistration(timeoutMs);
  if (!registration) {
    return null;
  }

  return registration.pushManager.getSubscription();
}

export async function ensureBrowserPushSubscription(
  vapidPublicKey: string,
  options: { timeoutMs?: number } = {}
) {
  if (!isPushManagerSupported()) {
    return null;
  }

  const normalizedKey = vapidPublicKey.trim();
  if (!normalizedKey) {
    return null;
  }

  const registration = await getNotificationServiceWorkerRegistration(options.timeoutMs ?? 1500);
  if (!registration) {
    return null;
  }

  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    return existing;
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeUrlSafeBase64(normalizedKey)
  });
}

export async function describeNotificationServiceWorker(
  timeoutMs = 1500
): Promise<NotificationServiceWorkerDescription> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return { supported: false };
  }

  try {
    const existing = await navigator.serviceWorker.getRegistration();
    const ready = await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs))
    ]);

    return {
      supported: true,
      existingScope: existing?.scope ?? null,
      existingActive: existing?.active?.scriptURL ?? null,
      existingState: existing?.active?.state ?? null,
      readyResolved: Boolean(ready),
      readyScope: ready?.scope ?? null,
      readyActive: ready?.active?.scriptURL ?? null,
      readyState: ready?.active?.state ?? null,
      showNotificationAvailable: typeof (existing ?? ready)?.showNotification === 'function'
    };
  } catch (error) {
    return {
      supported: true,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function requestNotificationPermission() {
  if (!isNotificationApiSupported()) {
    return null;
  }

  return Notification.requestPermission();
}

function attachNotificationClickHandler(notification: Notification, url?: string) {
  notification.onclick = () => {
    notification.close();
    window.focus();
    if (url) {
      window.location.assign(url);
    }
  };
}

export function showPageNotification(payload: NotificationPayload) {
  if (!isNotificationApiSupported()) {
    throw new Error('Notification API unavailable.');
  }

  const notification = new Notification(payload.title, {
    body: payload.body,
    tag: payload.tag
  });
  attachNotificationClickHandler(notification, payload.url);
  return notification;
}

export async function showServiceWorkerNotification(
  payload: NotificationPayload,
  options: { timeoutMs?: number } = {}
) {
  const registration = await getNotificationServiceWorkerRegistration(options.timeoutMs ?? 1500);
  if (!registration) {
    return false;
  }

  const notificationOptions: NotificationOptions = {
    body: payload.body,
    tag: payload.tag
  };
  if (payload.url) {
    notificationOptions.data = { url: payload.url };
  }

  await registration.showNotification(payload.title, notificationOptions);
  return true;
}

export async function deliverBrowserNotification(
  payload: NotificationPayload,
  options: {
    strategy?: 'page-first' | 'service-worker-first';
    timeoutMs?: number;
  } = {}
) {
  const strategy = options.strategy ?? 'page-first';
  const timeoutMs = options.timeoutMs ?? 1500;

  if (strategy === 'service-worker-first') {
    try {
      if (await showServiceWorkerNotification(payload, { timeoutMs })) {
        return 'service-worker' as const;
      }
    } catch {
      // Fall back to the page Notification API.
    }

    try {
      showPageNotification(payload);
      return 'page' as const;
    } catch {
      return null;
    }
  }

  try {
    showPageNotification(payload);
    return 'page' as const;
  } catch {
    // Fall back to service-worker delivery when page notifications are unavailable.
  }

  try {
    if (await showServiceWorkerNotification(payload, { timeoutMs })) {
      return 'service-worker' as const;
    }
  } catch {
    return null;
  }

  return null;
}