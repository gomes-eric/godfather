/** Work the bot keeps doing from startup until shutdown (reminders, polls, the daily check). */
export interface BackgroundJob {
  start(): void;
  stop(): void;
}

/**
 * Runs `task` now and then every `intervalMs`. A failed run goes to `onError` and the next one
 * still happens. Returns the function that stops it.
 */
export function repeat(
  intervalMs: number,
  task: () => Promise<unknown>,
  onError: (error: unknown) => void,
): () => void {
  const run = () => void task().catch(onError);
  run();
  const timer = setInterval(run, intervalMs);
  return () => clearInterval(timer);
}
