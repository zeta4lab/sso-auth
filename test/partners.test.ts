import { beforeEach, describe, expect, it } from 'vitest'
import { createAuditLog, type AuditEvent } from '../src/audit/log.ts'
import { PartnerError, createPartnerService } from '../src/partners/service.ts'
import { createFakeHydra } from './fakeHydra.ts'

let hydra: ReturnType<typeof createFakeHydra>
let events: (AuditEvent & { at: string })[]
let partners: ReturnType<typeof createPartnerService>

beforeEach(() => {
  hydra = createFakeHydra()
  events = []
  partners = createPartnerService(hydra.admin, createAuditLog((e) => events.push(e)))
})

const SCOPES = ['reports:read']
const AUDIENCES = ['https://api.example.com']

describe('파트너 등록', () => {
  it('클라이언트를 만들고 시크릿을 한 번 돌려준다', async () => {
    const credential = await partners.register('acme', SCOPES, AUDIENCES, 'operator')
    expect(credential.clientId).toBe('acme-g1')
    expect(credential.clientSecret).toBeTruthy()
    expect(credential.generation).toBe(1)
    expect(hydra.clients.get('acme-g1')?.scope).toBe('reports:read')
  })

  it('같은 파트너를 두 번 등록하지 않는다', async () => {
    await partners.register('acme', SCOPES, AUDIENCES, 'operator')
    await expect(partners.register('acme', SCOPES, AUDIENCES, 'operator')).rejects.toMatchObject({
      status: 409,
    })
  })

  it('잘못된 partnerId와 스코프 형식을 거부한다', async () => {
    await expect(partners.register('ACME!', SCOPES, AUDIENCES, 'op')).rejects.toThrow(PartnerError)
    await expect(partners.register('acme', ['reports'], AUDIENCES, 'op')).rejects.toThrow(PartnerError)
    await expect(partners.register('acme', SCOPES, [], 'op')).rejects.toThrow(PartnerError)
  })

  it('감사 로그를 남기되 시크릿은 담지 않는다', async () => {
    const credential = await partners.register('acme', SCOPES, AUDIENCES, 'operator')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ action: 'partner.register', partnerId: 'acme', actor: 'operator' })
    expect(JSON.stringify(events)).not.toContain(credential.clientSecret)
  })
})

describe('시크릿 회전', () => {
  beforeEach(async () => {
    await partners.register('acme', SCOPES, AUDIENCES, 'operator')
  })

  it('회전 중에는 옛 시크릿과 새 시크릿이 함께 유효하다', async () => {
    const next = await partners.beginRotation('acme', 'operator')
    expect(next.clientId).toBe('acme-g2')
    expect(hydra.clients.has('acme-g1')).toBe(true)
    expect(hydra.clients.has('acme-g2')).toBe(true)

    const view = await partners.get('acme')
    expect(view.rotationInProgress).toBe(true)
    expect(view.clients.map((c) => c.clientId)).toEqual(['acme-g2', 'acme-g1'])
  })

  it('새 클라이언트가 기존 스코프·audience를 그대로 물려받는다', async () => {
    await partners.beginRotation('acme', 'operator')
    const created = hydra.clients.get('acme-g2')
    expect(created?.scope).toBe('reports:read')
    expect(created?.audience).toEqual(AUDIENCES)
  })

  it('완료하면 이전 세대만 폐기된다', async () => {
    await partners.beginRotation('acme', 'operator')
    const view = await partners.completeRotation('acme', 'operator')
    expect(hydra.clients.has('acme-g1')).toBe(false)
    expect(hydra.clients.has('acme-g2')).toBe(true)
    expect(view.rotationInProgress).toBe(false)
  })

  it('회전이 겹치지 않게 막는다', async () => {
    await partners.beginRotation('acme', 'operator')
    await expect(partners.beginRotation('acme', 'operator')).rejects.toMatchObject({ status: 409 })
  })

  it('진행 중인 회전이 없으면 완료할 수 없다', async () => {
    await expect(partners.completeRotation('acme', 'operator')).rejects.toMatchObject({ status: 409 })
  })

  it('등록되지 않은 파트너는 회전할 수 없다', async () => {
    await expect(partners.beginRotation('unknown', 'operator')).rejects.toMatchObject({ status: 404 })
  })
})

describe('폐기', () => {
  it('회전 중이어도 모든 세대를 즉시 없앤다', async () => {
    await partners.register('acme', SCOPES, AUDIENCES, 'operator')
    await partners.beginRotation('acme', 'operator')

    const result = await partners.revoke('acme', 'operator', '시크릿 유출')
    expect(result.revoked.sort()).toEqual(['acme-g1', 'acme-g2'])
    expect(hydra.clients.size).toBe(0)
    expect(events.at(-1)).toMatchObject({
      action: 'partner.revoke',
      detail: { reason: '시크릿 유출' },
    })
  })

  it('폐기 후에는 조회되지 않는다', async () => {
    await partners.register('acme', SCOPES, AUDIENCES, 'operator')
    await partners.revoke('acme', 'operator', '계약 종료')
    await expect(partners.get('acme')).rejects.toMatchObject({ status: 404 })
  })
})
