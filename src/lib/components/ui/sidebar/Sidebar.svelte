<script lang="ts">
  import type { Snippet } from 'svelte';
  import { useSidebar } from './context.svelte';
  import { cn } from '../utils';
  import * as Sheet from '../sheet';

  let { class: className, children }: { class?: string; children?: Snippet } = $props();
  const sidebar = useSidebar();

  let mobileOpen = $state(false);
  $effect(() => {
    mobileOpen = sidebar.openMobile;
  });
  $effect(() => {
    if (sidebar.openMobile !== mobileOpen) sidebar.setOpenMobile(mobileOpen);
  });
</script>

{#if sidebar.isMobile}
  <Sheet.Root bind:open={mobileOpen}>
    <Sheet.Content
      side="left"
      class="bg-sidebar text-sidebar-foreground w-[18rem] p-0 [&>button]:hidden"
    >
      <div class="flex h-full w-full flex-col">
        {@render children?.()}
      </div>
    </Sheet.Content>
  </Sheet.Root>
{:else}
  <aside
    data-state={sidebar.open ? 'open' : 'closed'}
    class={cn(
      'bg-sidebar text-sidebar-foreground border-sidebar-border hidden h-svh shrink-0 border-r transition-[width,opacity] duration-200 ease-linear md:flex md:flex-col',
      sidebar.open ? 'w-[var(--sidebar-width)]' : 'w-0 overflow-hidden opacity-0',
      className
    )}
  >
    {@render children?.()}
  </aside>
{/if}
