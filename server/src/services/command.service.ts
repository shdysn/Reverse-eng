import { spawn } from 'node:child_process';
import { env } from '../config/env.js';
import type { CommandResult } from '../types/index.js';

export class CommandService {
  /**
   * Securely runs a controlled executable with arguments array, shell: false, and strict timeouts.
   */
  public async execute(
    executable: string,
    args: string[],
    options: {
      cwd?: string;
      timeoutMs?: number;
      maxOutputBytes?: number;
      env?: Record<string, string | undefined>;
    } = {}
  ): Promise<CommandResult> {
    const timeoutMs = options.timeoutMs ?? env.COMMAND_TIMEOUT_MS;
    const maxOutputBytes = options.maxOutputBytes ?? env.COMMAND_OUTPUT_LIMIT;
    const startTime = Date.now();

    return new Promise<CommandResult>((resolve, reject) => {
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let timedOut = false;
      let killed = false;

      // Ensure shell is explicitly false and arguments are array elements
      const child = spawn(executable, args, {
        shell: false,
        cwd: options.cwd || process.cwd(),
        env: {
          ...process.env,
          ...(options.env || {}),
        },
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killed = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdoutBuffer.length < maxOutputBytes) {
          stdoutBuffer += chunk.toString('utf-8');
          if (stdoutBuffer.length > maxOutputBytes) {
            stdoutBuffer = stdoutBuffer.slice(0, maxOutputBytes) + '\n[Output truncated: limit reached]';
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBuffer.length < maxOutputBytes) {
          stderrBuffer += chunk.toString('utf-8');
          if (stderrBuffer.length > maxOutputBytes) {
            stderrBuffer = stderrBuffer.slice(0, maxOutputBytes) + '\n[Stderr truncated: limit reached]';
          }
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        // Sanitize error message to avoid path or secret leakage
        reject(new Error(`Failed to spawn process '${executable}': ${err.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        // Mask signing secrets in output
        const maskedStdout = this.maskSecrets(stdoutBuffer);
        const maskedStderr = this.maskSecrets(stderrBuffer);

        resolve({
          exitCode: code ?? (killed ? -1 : 0),
          stdout: maskedStdout,
          stderr: maskedStderr,
          durationMs,
          timedOut,
        });
      });
    });
  }

  /**
   * Masks sensitive credentials like keystore passwords from log strings
   */
  public maskSecrets(text: string): string {
    if (!text) return '';
    return text
      .replace(new RegExp(this.escapeRegExp(env.TEST_KEY_PASSWORD), 'g'), '********')
      .replace(/pass:[^\s]+/gi, 'pass:********')
      .replace(/password=[^\s&]+/gi, 'password=********');
  }

  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Checks if an executable is runnable without throwing or hanging
   */
  public async checkExecutable(bin: string, testArgs: string[] = ['--version']): Promise<boolean> {
    try {
      const res = await this.execute(bin, testArgs, { timeoutMs: 5000 });
      // Most tools return 0 on --version or -version
      return res.exitCode === 0 || res.stdout.length > 0 || res.stderr.length > 0;
    } catch {
      return false;
    }
  }
}

export const commandService = new CommandService();
