export interface BackgroundJob {
  start(): () => void;
}

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
