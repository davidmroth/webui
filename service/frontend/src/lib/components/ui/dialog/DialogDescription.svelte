<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let { class: className, children, ...rest }: DialogPrimitive.DescriptionProps & { class?: string; children?: Snippet } = $props();
</script>
<DialogPrimitive.Description class={cn('text-sm text-muted-foreground', className)} {...rest}>
  {@render children?.()}
</DialogPrimitive.Description>
