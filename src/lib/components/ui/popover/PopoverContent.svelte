<script lang="ts">
  import { Popover as P } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let {
    class: className,
    sideOffset = 4,
    align = 'center',
    children,
    ...rest
  }: P.ContentProps & { class?: string; children?: Snippet } = $props();
</script>
<P.Portal>
  <P.Content
    {sideOffset}
    {align}
    class={cn(
      'z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
      className
    )}
    {...rest}
  >
    {@render children?.()}
  </P.Content>
</P.Portal>
