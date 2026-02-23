import pkg from './package.json';

export default {
  app: {
    name: 'Workforce',
    identifier: 'dev.workforce.app',
    version: pkg.version,
  },
  build: {
    bun: { entrypoint: 'src/bun/index.ts' },
    copy: { 'dist': 'dist' },
    mac: { codesign: true, notarize: true },
  },
};
