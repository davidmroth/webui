<script lang="ts">
  import { DropdownMenu as DM } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let {
    class: className,
    inset,
    children,
    ...rest
  }: DM.ItemProps & { class?: string; inset?: boolean; children?: Snippet } = $props();
</script>
<DM.Item
  class={cn(
    'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4',
    inset && 'pl-8',
    className
  )}
  {...rest}
>
  {@render children?.()}
</DM.Item>
