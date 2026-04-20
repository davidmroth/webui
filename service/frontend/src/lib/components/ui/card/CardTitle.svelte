<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let { class: className, children, ...rest }: HTMLAttributes<HTMLHeadingElement> & { class?: string; children?: Snippet } = $props();
</script>
<h3 class={cn('font-semibold leading-none tracking-tight', className)} {...rest}>{@render children?.()}</h3>
