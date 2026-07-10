<script lang="ts">
  interface Props {
    src: string;
    alt: string;
    class?: string;
  }

  let { src, alt, class: className = '' }: Props = $props();
  let objectUrl = $state<string | null>(null);
  let failed = $state(false);

  $effect(() => {
    const target = src;
    failed = false;
    let activeUrl: string | null = null;
    let cancelled = false;

    if (!target) {
      objectUrl = null;
      return;
    }

    void fetch(target, { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Image request failed with status ${response.status}`);
        }
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) {
          return;
        }
        activeUrl = URL.createObjectURL(blob);
        objectUrl = activeUrl;
      })
      .catch(() => {
        if (!cancelled) {
          failed = true;
          objectUrl = null;
        }
      });

    return () => {
      cancelled = true;
      if (activeUrl) {
        URL.revokeObjectURL(activeUrl);
      }
      objectUrl = null;
    };
  });
</script>

{#if objectUrl}
  <img class={className} src={objectUrl} {alt} />
{:else if failed}
  <div class="attachment-preview attachment-preview--error" role="img" aria-label={alt}>
    Image unavailable
  </div>
{:else}
  <div class="attachment-preview attachment-preview--loading" aria-hidden="true"></div>
{/if}
