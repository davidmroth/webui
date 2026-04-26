<script lang="ts">
  import { Monitor, Moon, Sun } from '@lucide/svelte';
  import { setMode, userPrefersMode } from 'mode-watcher';

  type ThemeModeOption = 'light' | 'dark' | 'system';

  let { compact = false, label = 'Color theme' } = $props<{
    compact?: boolean;
    label?: string;
  }>();

  const modeOrder: ThemeModeOption[] = ['dark', 'light', 'system'];
  const modeLabels: Record<ThemeModeOption, string> = {
    dark: 'Nite',
    light: 'Light',
    system: 'System'
  };

  function chooseMode(nextMode: ThemeModeOption) {
    setMode(nextMode);
  }

  function cycleMode() {
    const currentIndex = modeOrder.indexOf(userPrefersMode.current);
    const nextMode = modeOrder[(currentIndex + 1) % modeOrder.length] ?? 'dark';
    chooseMode(nextMode);
  }

  const currentMode = $derived(userPrefersMode.current);
  const nextMode = $derived(modeOrder[(modeOrder.indexOf(currentMode) + 1) % modeOrder.length] ?? 'dark');
  const buttonLabel = $derived(`Theme: ${modeLabels[currentMode]}. Click to switch to ${modeLabels[nextMode]}.`);
</script>

<button
  type="button"
  class={`theme-mode-toggle llama-toolbar-button llama-theme-toggle ${compact ? 'theme-mode-toggle--compact' : ''}`}
  aria-label={buttonLabel}
  title={buttonLabel}
  onclick={cycleMode}
>
  {#if currentMode === 'dark'}
    <Moon class="h-4 w-4" />
  {:else if currentMode === 'light'}
    <Sun class="h-4 w-4" />
  {:else}
    <Monitor class="h-4 w-4" />
  {/if}
  <span class="visually-hidden">{label}: {modeLabels[currentMode]}</span>
</button>