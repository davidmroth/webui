import adapter from '@sveltejs/adapter-node';

const config = {
  kit: {
    adapter: adapter(),
    alias: {
      $components: 'src/lib/components',
      $server: 'src/lib/server'
    }
  }
};

export default config;
