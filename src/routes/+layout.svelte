<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster } from 'svelte-sonner';
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
  });
</script>

<svelte:head>
  <title>Hermes</title>
  <meta name="application-name" content="Hermes WebUI" />
  <meta name="description" content="Hermes web interface" />
  <meta name="theme-color" content="#1d4ed8" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
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

