<script lang="ts">
  import '../app.css';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster } from 'svelte-sonner';
  import * as Tooltip from '$lib/components/ui/tooltip';

  let { children } = $props();
</script>

<svelte:head>
  <title>Hermes</title>
</svelte:head>

<ModeWatcher />
<Toaster richColors position="bottom-right" />

<Tooltip.Provider delayDuration={200}>
  {@render children()}
</Tooltip.Provider>
