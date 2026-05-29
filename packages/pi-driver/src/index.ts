// Pi Driver - Pi CLI driver for Pi Desktop
export interface PiDriverOptions {
  provider?: string;
  model?: string;
  cwd?: string;
}

// Align with actual IPC event types used by main process
export interface PiEvent {
  type: 'text_start' | 'text_delta' | 'turn_end' | 'error' | 'toolcall_start' | 'toolcall_end';
  text?: string;
  message?: string;
  tool?: string;
  input?: unknown;
  result?: unknown;
}

export class PiDriver {
  private options: PiDriverOptions;

  constructor(options: PiDriverOptions = {}) {
    this.options = options;
  }

  /**
   * Send a prompt to Pi CLI.
   * In the desktop app, actual CLI interaction is handled by the main process
   * via spawn('pi', ['--print', ...]). This class is a placeholder for future
   * direct SDK usage.
   */
  async sendPrompt(prompt: string): Promise<string> {
    throw new Error('Use window.piAPI.sendPrompt() in the desktop app. Direct PiDriver usage is not yet implemented.');
  }
}
