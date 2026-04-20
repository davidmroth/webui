<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let { class: className, children }: { class?: string; children?: Snippet } = $props();
</script>
<div class={cn('flex flex-col gap-2 p-2', className)}>{@render children?.()}</div>
