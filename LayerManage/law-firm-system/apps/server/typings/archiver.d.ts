declare module 'archiver' {
  import { Transform } from 'node:stream';
  interface Archive extends Transform {
    append(source: string | Buffer, data: {name: string; type?: 'directory'}): this;
    file(path: string, data: {name: string}): this;
    finalize(): Promise<void>;
    abort(): this;
  }
  function archiver(format: 'zip', options: {zlib: {level: number}}): Archive;
  export = archiver;
}
