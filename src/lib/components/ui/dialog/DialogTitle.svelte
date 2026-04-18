<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let { class: className, children, ...rest }: DialogPrimitive.TitleProps & { class?: string; children?: Snippet } = $props();
</script>
<DialogPrimitive.Title class={cn('text-lg font-semibold leading-none tracking-tight', className)} {...rest}>
  {@render children?.()}
</DialogPrimitive.Title>
