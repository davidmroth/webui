<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster, toast } from 'svelte-sonner';
  import * as Tooltip from '$lib/components/ui/tooltip';

  let { children } = $props();

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
    let buildFingerprint: string | undefined;

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
              void registration.update();
            }, 60_000);
          }
        });
      } catch (error) {
        console.warn('PWA updater could not be initialized', error);
      }
    };

    const checkBuildFingerprint = async () => {
      try {
        const response = await fetch(`/api/build-fingerprint?t=${Date.now()}`, {
          cache: 'no-store',
          headers: {
            pragma: 'no-cache',
            'cache-control': 'no-cache'
          }
        });

        if (!response.ok) return;

        const payload = (await response.json()) as { fingerprint?: string };
        const nextFingerprint = payload.fingerprint;
        if (!nextFingerprint) return;

        if (!buildFingerprint) {
          buildFingerprint = nextFingerprint;
          return;
        }

        if (nextFingerprint !== buildFingerprint) {
          buildFingerprint = nextFingerprint;
          showUpdateToast();
        }
      } catch (error) {
        console.warn('Build fingerprint check failed', error);
      }
    };

    void installPwaUpdateFlow();
    void checkBuildFingerprint();

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void navigator.serviceWorker?.getRegistration()?.then((registration) => registration?.update());
        void checkBuildFingerprint();
      }
    };

    const fingerprintInterval = setInterval(() => {
      void checkBuildFingerprint();
    }, 60_000);

    document.addEventListener('visibilitychange', onVisible);

    return () => {
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
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.svg" />
  <link rel="mask-icon" href="/mask-icon.svg" color="#1d4ed8" />
</svelte:head>

<ModeWatcher />
<Toaster richColors position="bottom-right" />

<Tooltip.Provider delayDuration={200}>
  {@render children()}
</Tooltip.Provider>

<div class="app-loading-overlay" aria-hidden="true">
  <div class="app-loading-spinner"></div>
</div>

