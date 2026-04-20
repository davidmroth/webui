<script lang="ts" module>
  import { tv, type VariantProps } from 'tailwind-variants';
  export const alertVariants = tv({
    base: 'relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7',
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive: 'border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive'
      }
    },
    defaultVariants: { variant: 'default' }
  });
  export type V = VariantProps<typeof alertVariants>['variant'];
</script>

<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { cn } from '../utils';
  let { class: className, variant = 'default', children, ...rest }: HTMLAttributes<HTMLDivElement> & { class?: string; variant?: V; children?: Snippet } = $props();
</script>
<div role="alert" class={cn(alertVariants({ variant }), className)} {...rest}>{@render children?.()}</div>
