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
</svelte:head>

<ModeWatcher />
<Toaster richColors position="bottom-right" />

<Tooltip.Provider delayDuration={200}>
  {@render children()}
</Tooltip.Provider>

<div class="app-loading-overlay" aria-hidden="true">
  <div class="app-loading-spinner"></div>
</div>

