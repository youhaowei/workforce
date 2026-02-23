import pkg from './package.json';

export default {
  app: {
    name: 'Workforce',
    identifier: 'dev.workforce.app',
    version: pkg.version,
  },
  build: {
    bun: {
      entrypoint: 'src/bun/index.ts',
      external: ['electrobun/bun'],
    },
    copy: { 'dist': 'dist' },
    mac: { codesign: false, notarize: false },
  },
};
