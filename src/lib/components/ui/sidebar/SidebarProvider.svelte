<script lang="ts">
  import type { Snippet } from 'svelte';
  import { createSidebarState, SIDEBAR_WIDTH } from './context.svelte';
  import { cn } from '../utils';

  let {
    defaultOpen = true,
    class: className,
    children
  }: { defaultOpen?: boolean; class?: string; children?: Snippet } = $props();

  createSidebarState(defaultOpen as boolean);
</script>

<div
  class={cn('flex min-h-svh w-full', className)}
  style:--sidebar-width={SIDEBAR_WIDTH}
>
  {@render children?.()}
</div>
