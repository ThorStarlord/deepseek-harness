/** Serializes writes whose persisted revisions depend on earlier records. @module @deepseek-ai/dsh-home-activity/operation-queue */

/** Creates an instance-local queue that remains usable after a rejected operation.
 * @returns A function that serializes one service instance's persistence operations.
 */
export function createActivityOperationQueue(): <T>(operation: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve()
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation)
    tail = result.then(() => {}, () => {})
    return result
  }
}
