<script lang="ts">
  import { Tooltip as T } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let {
    class: className,
    sideOffset = 4,
    children,
    ...rest
  }: T.ContentProps & { class?: string; children?: Snippet } = $props();
</script>
<T.Portal>
  <T.Content
    {sideOffset}
    class={cn(
      'z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-md animate-in fade-in-0 zoom-in-95',
      className
    )}
    {...rest}
  >
    {@render children?.()}
  </T.Content>
</T.Portal>
