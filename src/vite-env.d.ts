/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_PORT: string;
  /** Git branch name, only set in dev mode. */
  readonly VITE_GIT_BRANCH: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
