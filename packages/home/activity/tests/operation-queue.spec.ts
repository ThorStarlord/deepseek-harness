import { expect, it } from 'vitest'
import { createActivityOperationQueue } from '../src/operation-queue.ts'

it('serializes operations and continues after one operation rejects', async () => {
  const enqueue = createActivityOperationQueue()
  const order: string[] = []
  let releaseFirst = () => {}
  let markFirstStarted = () => {}
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve })
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })

  const first = enqueue(async () => {
    order.push('first-started')
    markFirstStarted()
    await firstGate
    order.push('first-finished')
    return 'first'
  })
  const second = enqueue(async () => {
    order.push('second-started')
    return 'second'
  })
  const otherQueue = createActivityOperationQueue()

  await firstStarted
  expect(order).toEqual(['first-started'])
  await expect(otherQueue(async () => 'other service')).resolves.toBe('other service')
  releaseFirst()
  await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
  expect(order).toEqual(['first-started', 'first-finished', 'second-started'])

  const rejected = enqueue(async () => {
    throw new Error('operation failed')
  })
  const recovered = enqueue(async () => 'after-failure')
  await expect(rejected).rejects.toThrow('operation failed')
  await expect(recovered).resolves.toBe('after-failure')
})
