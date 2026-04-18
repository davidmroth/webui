<script lang="ts">
  import { AlertDialog as AD } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let { class: className, children, ...rest }: AD.ContentProps & { class?: string; children?: Snippet } = $props();
</script>
<AD.Portal>
  <AD.Overlay class="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
  <AD.Content
    class={cn(
      'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 sm:rounded-lg',
      className
    )}
    {...rest}
  >
    {@render children?.()}
  </AD.Content>
</AD.Portal>
