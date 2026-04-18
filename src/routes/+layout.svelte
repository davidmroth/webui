<script lang="ts">
  import '../app.css';

  let { data, children } = $props();
</script>

<svelte:head>
  <title>llama.cpp</title>
</svelte:head>

{@render children()}
