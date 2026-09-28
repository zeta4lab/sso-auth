import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/server.ts'
import { createFakeHydra } from './fakeHydra.ts'

const ADMIN_TOKEN = 'test-admin-token-0123456789'
const auth = { authorization: `Bearer ${ADMIN_TOKEN}`, 'x-actor': 'operator@example.com' }

let app: FastifyInstance
let hydra: ReturnType<typeof createFakeHydra>

beforeEach(() => {
  hydra = createFakeHydra()
  app = buildServer(
    {
      port: 0,
      adminApiToken: ADMIN_TOKEN,
      hydraAdminUrl: 'http://hydra:4445',
      hydraPublicUrl: 'http://hydra:4444',
    },
    { hydra: hydra.admin, auditSink: () => {} },
  )
  app.log.level = 'silent'
})

afterEach(async () => {
  await app.close()
})

describe('관리 API 인증', () => {
  it('토큰 없이는 거부한다', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/partners/acme' })
    expect(res.statusCode).toBe(401)
  })

  it('틀린 토큰도 거부한다', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/partners/acme',
      headers: { authorization: 'Bearer wrong-token-0123456789' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('헬스체크는 토큰 없이 열려 있다', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
  })
})

describe('파트너 관리 흐름', () => {
  it('등록 → 회전 → 완료를 HTTP로 수행한다', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/admin/partners',
      headers: auth,
      payload: { partnerId: 'acme', scopes: ['reports:read'], audiences: ['https://api.example.com'] },
    })
    expect(registered.statusCode).toBe(201)
    expect(registered.json()).toMatchObject({ clientId: 'acme-g1', generation: 1 })

    const rotated = await app.inject({
      method: 'POST',
      url: '/admin/partners/acme/rotations',
      headers: auth,
    })
    expect(rotated.statusCode).toBe(201)
    expect(rotated.json().clientId).toBe('acme-g2')

    const during = await app.inject({ method: 'GET', url: '/admin/partners/acme', headers: auth })
    expect(during.json().rotationInProgress).toBe(true)

    const completed = await app.inject({
      method: 'POST',
      url: '/admin/partners/acme/rotations/complete',
      headers: auth,
    })
    expect(completed.statusCode).toBe(200)
    expect(completed.json().clients).toHaveLength(1)
    expect(hydra.clients.has('acme-g1')).toBe(false)
  })

  it('잘못된 요청 본문은 400으로 돌려준다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/partners',
      headers: auth,
      payload: { partnerId: 'acme', scopes: [], audiences: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('폐기는 사유를 요구한다', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/partners',
      headers: auth,
      payload: { partnerId: 'acme', scopes: ['reports:read'], audiences: ['https://api.example.com'] },
    })
    const noReason = await app.inject({
      method: 'POST',
      url: '/admin/partners/acme/revocation',
      headers: auth,
      payload: {},
    })
    expect(noReason.statusCode).toBe(400)

    const revoked = await app.inject({
      method: 'POST',
      url: '/admin/partners/acme/revocation',
      headers: auth,
      payload: { reason: '시크릿 유출' },
    })
    expect(revoked.statusCode).toBe(200)
    expect(hydra.clients.size).toBe(0)
  })
})
