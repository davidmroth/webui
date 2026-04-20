<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '../utils';
  let { class: className, ...rest }: HTMLAttributes<HTMLDivElement> & { class?: string } = $props();
</script>
<div class={cn('animate-pulse rounded-md bg-muted', className)} {...rest}></div>
