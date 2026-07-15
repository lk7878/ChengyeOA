import { Writable } from 'node:stream';
import readline from 'node:readline';

export interface Prompts {
  text(label: string): Promise<string>;
  secret(label: string): Promise<string>;
  close(): void;
}

class MutedWritable extends Writable {
  muted = false;

  _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (!this.muted) process.stdout.write(chunk, encoding);
    callback();
  }
}

export class TerminalPrompts implements Prompts {
  private readonly output = new MutedWritable();
  private terminal: readline.Interface | undefined;

  async text(label: string): Promise<string> {
    return this.ask(label, false);
  }

  async secret(label: string): Promise<string> {
    return this.ask(label, true);
  }

  close(): void {
    this.terminal?.close();
  }

  private ask(label: string, muted: boolean): Promise<string> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return Promise.reject(new Error('Interactive terminal is required'));
    }

    return new Promise(resolve => {
      this.getTerminal().question(label, answer => {
        this.output.muted = false;
        if (muted) this.output.write('\n');
        resolve(answer);
      });
      this.output.muted = muted;
    });
  }

  private getTerminal(): readline.Interface {
    this.terminal ??= readline.createInterface({
      input: process.stdin,
      output: this.output,
      terminal: true,
    });
    return this.terminal;
  }
}
