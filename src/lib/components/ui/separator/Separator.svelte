<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '../utils';
  let {
    orientation = 'horizontal',
    class: className,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & { orientation?: 'horizontal' | 'vertical'; class?: string } =
    $props();
</script>

<div
  role="separator"
  class={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
  {...rest}
></div>
