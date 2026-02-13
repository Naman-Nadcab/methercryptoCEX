declare module 'qrcode' {
  export function toDataURL(
    text: string,
    options?: { type?: string; margin?: number; width?: number; color?: { dark?: string; light?: string } }
  ): Promise<string>;
  export function toString(text: string, options?: object): Promise<string>;
}
