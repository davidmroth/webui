<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let { class: className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { class?: string; children?: Snippet } = $props();
</script>
<div class={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} {...rest}>{@render children?.()}</div>
