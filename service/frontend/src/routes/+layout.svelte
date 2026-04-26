<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster, toast } from 'svelte-sonner';
  import * as Tooltip from '$lib/components/ui/tooltip';

  let { children } = $props();

  const LINK_WINDOW_FEATURES = 'noopener,noreferrer';
  const MOBILE_VIEWPORT_MEDIA_QUERY = '(max-width: 768px)';
  const UPDATE_CHECK_INTERVAL_MS = 5 * 60_000;
  const SHOULD_USE_PWA_UPDATER = import.meta.env.PROD;
  const DEV_SERVICE_WORKER_PATHS = new Set(['/dev-sw.js', '/sw.js']);

  function shouldOpenAnchorInNewWindow(anchor: HTMLAnchorElement) {
    if (!anchor.href || anchor.hasAttribute('download')) {
      return false;
    }

    return !anchor.href.startsWith('javascript:');
  }

  function applyAnchorDefaults(root: ParentNode = document) {
    for (const anchor of root.querySelectorAll('a[href]')) {
      if (!(anchor instanceof HTMLAnchorElement) || !shouldOpenAnchorInNewWindow(anchor)) {
        continue;
      }

      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
  }

  function openAnchorInNewWindow(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement) || !shouldOpenAnchorInNewWindow(anchor)) {
      return;
    }

    event.preventDefault();
    window.open(anchor.href, '_blank', LINK_WINDOW_FEATURES);
  }

  function suppressContextMenu(event: MouseEvent) {
    if (!window.matchMedia(MOBILE_VIEWPORT_MEDIA_QUERY).matches) {
      return;
    }

    event.preventDefault();
  }

  onMount(() => {
    // Clear the boot-time `app-init` class once the app has hydrated and
    // painted at least once. Two RAFs ensures Svelte's first DOM update has
    // committed before transitions/animations are re-enabled.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove('app-init');
      });
    });

    let updateToastVisible = false;
    let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;
    let refreshInterval: ReturnType<typeof setInterval> | undefined;
    const buildFingerprintStorageKey = 'hermes_webui_last_seen_build_fingerprint';
    let buildFingerprint: string | undefined;
    let lastBuildFingerprintCheckAt = 0;
    let buildFingerprintCheckInFlight: Promise<void> | null = null;

    try {
      buildFingerprint = localStorage.getItem(buildFingerprintStorageKey) ?? undefined;
    } catch {
      buildFingerprint = undefined;
    }

    const showUpdateToast = () => {
      if (updateToastVisible) return;
      updateToastVisible = true;

      toast('A new version is ready', {
        description: 'Tap Update to reload with the latest code.',
        duration: Infinity,
        action: {
          label: 'Update',
          onClick: () => {
            if (updateServiceWorker) {
              void updateServiceWorker(true);
              return;
            }
            window.location.reload();
          }
        },
        onDismiss: () => {
          updateToastVisible = false;
        },
        onAutoClose: () => {
          updateToastVisible = false;
        }
      });
    };

    const unregisterStaleDevServiceWorkers = async () => {
      if (SHOULD_USE_PWA_UPDATER || !('serviceWorker' in navigator)) {
        return;
      }

      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations
            .filter((registration) => {
              const scriptUrl =
                registration.active?.scriptURL ??
                registration.waiting?.scriptURL ??
                registration.installing?.scriptURL;

              if (!scriptUrl) {
                return false;
              }

              const script = new URL(scriptUrl);
              return (
                script.origin === window.location.origin &&
                DEV_SERVICE_WORKER_PATHS.has(script.pathname)
              );
            })
            .map((registration) => registration.unregister())
        );
      } catch (error) {
        console.warn('Failed to clear stale development service workers', error);
      }
    };

    const installPwaUpdateFlow = async () => {
      try {
        const { registerSW } = await import('virtual:pwa-register');

        updateServiceWorker = registerSW({
          immediate: true,
          onNeedRefresh() {
            showUpdateToast();
          },
          onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
            if (!registration) return;
            refreshInterval = setInterval(() => {
              if (document.visibilityState !== 'visible') {
                return;
              }
              void registration.update();
            }, UPDATE_CHECK_INTERVAL_MS);
          }
        });
      } catch (error) {
        console.warn('PWA updater could not be initialized', error);
      }
    };

    const checkBuildFingerprint = async (options: { force?: boolean } = {}) => {
      const force = options.force ?? false;
      const now = Date.now();
      if (!force) {
        if (document.visibilityState !== 'visible') {
          return;
        }

        if (now - lastBuildFingerprintCheckAt < UPDATE_CHECK_INTERVAL_MS) {
          return;
        }
      }

      if (buildFingerprintCheckInFlight) {
        return buildFingerprintCheckInFlight;
      }

      lastBuildFingerprintCheckAt = now;
      buildFingerprintCheckInFlight = (async () => {
        try {
          const response = await fetch(`/api/build-fingerprint?t=${Date.now()}`, {
            cache: 'no-store',
            headers: {
              pragma: 'no-cache',
              'cache-control': 'no-cache'
            }
          });

          if (!response.ok) return;

          const payload = (await response.json()) as { version?: string; fingerprint?: string };
          const nextFingerprint = payload.fingerprint ?? payload.version;
          if (!nextFingerprint) return;

          if (!buildFingerprint) {
            buildFingerprint = nextFingerprint;
            try {
              localStorage.setItem(buildFingerprintStorageKey, nextFingerprint);
            } catch {
              // Ignore storage write failures (private mode, quota, etc.).
            }
            return;
          }

          if (nextFingerprint !== buildFingerprint) {
            buildFingerprint = nextFingerprint;
            try {
              localStorage.setItem(buildFingerprintStorageKey, nextFingerprint);
            } catch {
              // Ignore storage write failures (private mode, quota, etc.).
            }
            showUpdateToast();
          }
        } catch (error) {
          console.warn('Build fingerprint check failed', error);
        } finally {
          buildFingerprintCheckInFlight = null;
        }
      })();

      return buildFingerprintCheckInFlight;
    };

    void unregisterStaleDevServiceWorkers();

    if (SHOULD_USE_PWA_UPDATER) {
      void installPwaUpdateFlow();
    }
    void checkBuildFingerprint({ force: true });

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        if (SHOULD_USE_PWA_UPDATER) {
          void navigator.serviceWorker
            ?.getRegistration()
            ?.then((registration) => registration?.update());
        }
        void checkBuildFingerprint();
      }
    };

    const fingerprintInterval = setInterval(() => {
      void checkBuildFingerprint();
    }, UPDATE_CHECK_INTERVAL_MS);
    const anchorObserver = new MutationObserver((entries) => {
      for (const entry of entries) {
        for (const node of entry.addedNodes) {
          if (!(node instanceof Element)) {
            continue;
          }

          if (node.matches('a[href]')) {
            applyAnchorDefaults(node.parentElement ?? document);
            continue;
          }

          applyAnchorDefaults(node);
        }
      }
    });

    applyAnchorDefaults();
    anchorObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', openAnchorInNewWindow, true);
    document.addEventListener('contextmenu', suppressContextMenu, true);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      anchorObserver.disconnect();
      document.removeEventListener('click', openAnchorInNewWindow, true);
      document.removeEventListener('contextmenu', suppressContextMenu, true);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(fingerprintInterval);
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  });
</script>

<svelte:head>
  <title>Hermes</title>
  <meta name="application-name" content="Hermes WebUI" />
  <meta name="description" content="Hermes web interface" />
  <meta name="theme-color" content="#1d4ed8" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <link rel="icon" href="/favicon.png" type="image/png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="mask-icon" href="/mask-icon.svg" color="#d4a017" />
</svelte:head>

<ModeWatcher />
<Toaster richColors position="bottom-right" />

<Tooltip.Provider delayDuration={200}>
  {@render children()}
</Tooltip.Provider>

<div class="app-loading-overlay" aria-hidden="true">
  <div class="app-loading-spinner"></div>
</div>

