import { v4 as uuidv4 } from 'uuid';

export interface PendingCommand {
  id: string;
  type: string;
  payload: unknown;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  createdAt: number;
}

export const commandQueue: PendingCommand[] = [];

const MAX_QUEUE_SIZE = 100;
const COMMAND_TIMEOUT_MS = 30_000;
const SWEEP_INTERVAL_MS = 5_000;

export function enqueueCommand(type: string, payload: unknown): Promise<unknown> {
  if (commandQueue.length >= MAX_QUEUE_SIZE) {
    return Promise.reject(new Error('Command queue is full — the Figma plugin may not be connected.'));
  }
  return new Promise((resolve, reject) => {
    commandQueue.push({
      id: uuidv4(),
      type,
      payload,
      resolve,
      reject,
      createdAt: Date.now(),
    });
  });
}

export function startTimeoutSweep(): void {
  setInterval(() => {
    const now = Date.now();
    for (let i = commandQueue.length - 1; i >= 0; i--) {
      const cmd = commandQueue[i];
      if (now - cmd.createdAt > COMMAND_TIMEOUT_MS) {
        commandQueue.splice(i, 1);
        cmd.reject(new Error(`Command ${cmd.id} timed out after ${COMMAND_TIMEOUT_MS}ms — is the Figma plugin running?`));
      }
    }
  }, SWEEP_INTERVAL_MS);
}
