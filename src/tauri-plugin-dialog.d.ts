declare module "@tauri-apps/plugin-dialog" {
  export type OpenDialogOptions = {
    title?: string;
    multiple?: boolean;
    directory?: boolean;
    recursive?: boolean;
    defaultPath?: string;
  };

  export function open(
    options?: OpenDialogOptions,
  ): Promise<string | string[] | null>;
}
