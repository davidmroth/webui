<script lang="ts">
  import { DropdownMenu as DM } from 'bits-ui';
  import { cn } from '../utils';
  let { class: className, ...rest }: DM.SeparatorProps & { class?: string } = $props();
</script>
<DM.Separator class={cn('-mx-1 my-1 h-px bg-border', className)} {...rest} />
