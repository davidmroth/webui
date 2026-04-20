<script lang="ts">
  import { ScrollArea as S } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let {
    class: className,
    orientation = 'vertical',
    children,
    ...rest
  }: S.RootProps & { class?: string; orientation?: 'vertical' | 'horizontal' | 'both'; children?: Snippet } =
    $props();
</script>
<S.Root class={cn('relative overflow-hidden', className)} {...rest}>
  <S.Viewport class="h-full w-full rounded-[inherit]">
    {@render children?.()}
  </S.Viewport>
  {#if orientation === 'vertical' || orientation === 'both'}
    <S.Scrollbar
      orientation="vertical"
      class="flex h-full touch-none select-none border-l border-l-transparent p-[1px] transition-colors w-2.5"
    >
      <S.Thumb class="relative flex-1 rounded-full bg-border" />
    </S.Scrollbar>
  {/if}
  {#if orientation === 'horizontal' || orientation === 'both'}
    <S.Scrollbar
      orientation="horizontal"
      class="flex touch-none select-none border-t border-t-transparent p-[1px] transition-colors h-2.5 flex-col"
    >
      <S.Thumb class="relative flex-1 rounded-full bg-border" />
    </S.Scrollbar>
  {/if}
  <S.Corner />
</S.Root>
