<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let { class: className, children }: { class?: string; children?: Snippet } = $props();
</script>
<main class={cn('relative flex min-h-svh flex-1 flex-col overflow-hidden bg-background', className)}>
  {@render children?.()}
</main>
