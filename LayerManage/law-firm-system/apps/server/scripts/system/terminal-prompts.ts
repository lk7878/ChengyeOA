import { Writable } from 'node:stream';
import readline from 'node:readline';

export interface Prompts {
  text(label: string): Promise<string>;
  secret(label: string): Promise<string>;
  close(): void;
}

class MutedWritable extends Writable {
  constructor(private readonly target: NodeJS.WritableStream) {
    super();
  }

  muted = false;

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (!this.muted) this.target.write(chunk);
    callback();
  }
}

export interface TerminalPromptDependencies {
  input: NodeJS.ReadableStream & { isTTY?: boolean };
  output: NodeJS.WritableStream & { isTTY?: boolean };
  createInterface(options: Parameters<typeof readline.createInterface>[0]): Pick<readline.Interface, 'question' | 'close'>;
}

const productionDependencies: TerminalPromptDependencies = {
  input: process.stdin,
  output: process.stdout,
  createInterface: readline.createInterface,
};

export class TerminalPrompts implements Prompts {
  private readonly output: MutedWritable;
  private terminal: Pick<readline.Interface, 'question' | 'close'> | undefined;

  constructor(private readonly dependencies: TerminalPromptDependencies = productionDependencies) {
    this.output = new MutedWritable(dependencies.output);
  }

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
    if (!this.dependencies.input.isTTY || !this.dependencies.output.isTTY) {
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

  private getTerminal(): Pick<readline.Interface, 'question' | 'close'> {
    this.terminal ??= this.dependencies.createInterface({
      input: this.dependencies.input,
      output: this.output,
      terminal: true,
    });
    return this.terminal;
  }
}
