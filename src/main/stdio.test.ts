import { describe, expect, it } from 'vitest'
import { handleOutputError } from './stdio'

describe('desktop output pipes', () => {
  it('tolerates a launcher closing its output pipe', () => {
    const error = Object.assign(new Error('broken pipe'), { code: 'EPIPE' })
    expect(() => handleOutputError(error)).not.toThrow()
  })

  it('propagates other output errors', () => {
    const error = Object.assign(new Error('output failure'), { code: 'EIO' })
    expect(() => handleOutputError(error)).toThrow(error)
  })
})
