<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let { class: className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { class?: string; children?: Snippet } = $props();
</script>
<div class={cn('flex flex-col gap-1.5 p-6', className)} {...rest}>{@render children?.()}</div>
