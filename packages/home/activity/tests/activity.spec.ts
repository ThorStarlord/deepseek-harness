import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import HomeActivityService, { ActivityError, ActivityId } from '../src/index.ts'
import type { CreateActivityRequest } from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const request: CreateActivityRequest = {
  name: 'Release readiness',
  objective: 'Prepare the next release for review.',
  boundaries: {
    inScope: ['Inspect release notes and focused validation results.'],
    outOfScope: ['Do not publish or deploy.'],
  },
}

async function open(root: string) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const fiber = await ctx.plugin(HomeActivityService)
  return { ctx, fiber }
}

it('keeps a named Activity and its scope after closing the service and reopening JSON storage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-')); roots.push(root)
  const first = await open(root)
  const created = await first.ctx.homeActivities.create(request)
  expect(created.id).toMatch(/^[0-9a-f-]{36}$/u)
  expect(first.ctx.homeActivities.list()).toEqual([created])
  await first.ctx.fiber.dispose()

  const second = await open(root)
  expect(second.ctx.homeActivities.get(ActivityId(created.id))).toEqual(created)
  expect(second.ctx.homeActivities.list()).toEqual([created])
})

it('rejects blank or unbounded create data before writing a record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-invalid-')); roots.push(root)
  const test = await open(root)
  await expect(test.ctx.homeActivities.create({ ...request, name: '  ' }))
    .rejects.toBeInstanceOf(ActivityError)
  await expect(test.ctx.homeActivities.create({
    ...request,
    boundaries: { inScope: [], outOfScope: ['Do not deploy.'] },
  })).rejects.toBeInstanceOf(ActivityError)
  expect(test.ctx.homeActivities.list()).toEqual([])
})

it('orders Activities by creation time and then stable identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-order-')); roots.push(root)
  const test = await open(root)
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'))
    const older = await test.ctx.homeActivities.create(request)
    vi.setSystemTime(new Date('2026-11-14T12:00:01.000Z'))
    const newerA = await test.ctx.homeActivities.create(request)
    const newerB = await test.ctx.homeActivities.create(request)
    expect(test.ctx.homeActivities.list().map(activity => activity.id)).toEqual(
      [newerA, newerB].sort((left, right) => String(left.id).localeCompare(String(right.id))).map(activity => activity.id).concat(older.id),
    )
  } finally {
    vi.useRealTimers()
  }
})

it('rejects reads before the Activity storage service is initialized', () => {
  const service = new HomeActivityService(new Context())
  expect(() => service.list()).toThrow('Home Activity storage is not ready')
})
