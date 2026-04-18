<script lang="ts">
  import { PanelLeft } from '@lucide/svelte';
  import { useSidebar } from './context.svelte';
  import { cn } from '../utils';

  let { class: className }: { class?: string } = $props();
  const sidebar = useSidebar();
</script>

<button
  type="button"
  aria-label="Toggle sidebar"
  class={cn(
    'inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
    className
  )}
  onclick={() => sidebar.toggle()}
>
  <PanelLeft class="h-4 w-4" />
</button>
