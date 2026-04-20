<script lang="ts">
  import { Checkbox as C } from 'bits-ui';
  import { Check } from '@lucide/svelte';
  import { cn } from '../utils';
  let { class: className, ...rest }: C.RootProps & { class?: string } = $props();
</script>
<C.Root
  class={cn(
    'peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
    className
  )}
  {...rest}
>
  {#snippet children({ checked })}
    <span class="flex items-center justify-center text-current">
      {#if checked === true}<Check class="h-3.5 w-3.5" />{/if}
    </span>
  {/snippet}
</C.Root>
