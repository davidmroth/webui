<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let {
    class: className,
    inset,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & { class?: string; inset?: boolean; children?: Snippet } =
    $props();
</script>
<div class={cn('px-2 py-1.5 text-sm font-semibold', inset && 'pl-8', className)} {...rest}>
  {@render children?.()}
</div>
