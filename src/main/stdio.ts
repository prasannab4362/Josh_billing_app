/** A launcher may close its output pipes while the desktop app is still running. */
export function handleOutputError(error: NodeJS.ErrnoException): void {
  if (error.code === 'EPIPE') return
  throw error
}

export function protectOutputPipes(): void {
  process.stdout.on('error', handleOutputError)
  process.stderr.on('error', handleOutputError)
}
