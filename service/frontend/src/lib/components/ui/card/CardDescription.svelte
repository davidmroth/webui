<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let { class: className, children, ...rest }: HTMLAttributes<HTMLParagraphElement> & { class?: string; children?: Snippet } = $props();
</script>
<p class={cn('text-sm text-muted-foreground', className)} {...rest}>{@render children?.()}</p>
