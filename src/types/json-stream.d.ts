declare module 'JSONStream' {
  export type Options = {
    recurse: boolean;
  };
  export function parse(pattern: any): NodeJS.ReadWriteStream;
  export function parse(patterns: any[]): NodeJS.ReadWriteStream;
  export function stringify(open: string, separator: string, close: string): NodeJS.ReadWriteStream;
  export function stringify(newlineOnly?: NewlineOnlyIndicator): NodeJS.ReadWriteStream;
  export type NewlineOnlyIndicator = false;
  export function stringifyObject(): NodeJS.ReadWriteStream;
  export function stringifyObject(open: string, separator: string, close: string): NodeJS.ReadWriteStream;
}
