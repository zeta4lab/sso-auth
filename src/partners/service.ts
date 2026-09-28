import type { HydraAdmin, OAuth2Client } from '../hydra/adminClient.ts'
import type { AuditLog } from '../audit/log.ts'

export type PartnerCredential = {
  clientId: string
  clientSecret: string
  generation: number
}

export type PartnerClientView = {
  clientId: string
  generation: number
  scopes: string[]
  audiences: string[]
  createdAt: string
}

export type PartnerView = {
  partnerId: string
  clients: PartnerClientView[]
  rotationInProgress: boolean
}

export class PartnerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'PartnerError'
  }
}

const PARTNER_ID = /^[a-z0-9][a-z0-9-]{1,62}$/
const SCOPE = /^[a-z0-9-]+:[a-z0-9-]+$/

export function assertPartnerId(partnerId: string): void {
  if (!PARTNER_ID.test(partnerId)) {
    throw new PartnerError('partnerId는 소문자·숫자·하이픈 2~63자여야 한다', 400)
  }
}

function assertScopes(scopes: string[]): void {
  if (scopes.length === 0) throw new PartnerError('스코프를 최소 하나 지정해야 한다', 400)
  const bad = scopes.filter((s) => !SCOPE.test(s))
  if (bad.length > 0) {
    throw new PartnerError(`스코프 형식은 <리소스>:<행위>여야 한다: ${bad.join(', ')}`, 400)
  }
}

function generationOf(client: OAuth2Client): number {
  const raw = (client.metadata as { generation?: unknown } | undefined)?.generation
  return typeof raw === 'number' ? raw : 0
}

function toView(client: OAuth2Client): PartnerClientView {
  const metadata = (client.metadata ?? {}) as { createdAt?: unknown }
  return {
    clientId: client.client_id,
    generation: generationOf(client),
    scopes: client.scope ? client.scope.split(' ').filter(Boolean) : [],
    audiences: client.audience ?? [],
    createdAt: typeof metadata.createdAt === 'string' ? metadata.createdAt : '',
  }
}

/** 세대 내림차순. 가장 최근에 발급한 클라이언트가 앞에 온다. */
function byGenerationDesc(clients: OAuth2Client[]): OAuth2Client[] {
  return [...clients].sort((a, b) => generationOf(b) - generationOf(a))
}

export function createPartnerService(hydra: HydraAdmin, audit: AuditLog, now: () => Date = () => new Date()) {
  async function loadClients(partnerId: string): Promise<OAuth2Client[]> {
    return byGenerationDesc(await hydra.listClientsByOwner(partnerId))
  }

  async function issue(
    partnerId: string,
    generation: number,
    scopes: string[],
    audiences: string[],
  ): Promise<PartnerCredential> {
    const created = await hydra.createClient({
      clientId: `${partnerId}-g${generation}`,
      clientName: `${partnerId} (gen ${generation})`,
      owner: partnerId,
      scopes,
      audiences,
      metadata: { partnerId, generation, createdAt: now().toISOString() },
    })
    if (!created.client_secret) {
      // 시크릿은 생성 응답에서만 볼 수 있다. 없으면 파트너에게 전달할 방법이 없다.
      throw new PartnerError('Hydra가 client_secret을 반환하지 않았다', 502)
    }
    return { clientId: created.client_id, clientSecret: created.client_secret, generation }
  }

  return {
    /** 파트너를 처음 등록한다. 시크릿은 이 응답에서만 볼 수 있다. */
    async register(
      partnerId: string,
      scopes: string[],
      audiences: string[],
      actor: string,
    ): Promise<PartnerCredential> {
      assertPartnerId(partnerId)
      assertScopes(scopes)
      if (audiences.length === 0) throw new PartnerError('audience를 최소 하나 지정해야 한다', 400)

      const existing = await loadClients(partnerId)
      if (existing.length > 0) {
        throw new PartnerError(`이미 등록된 파트너다: ${partnerId}`, 409)
      }

      const credential = await issue(partnerId, 1, scopes, audiences)
      audit({ action: 'partner.register', partnerId, actor, result: 'ok', detail: { scopes, audiences } })
      return credential
    },

    /**
     * 회전을 시작한다. 새 세대 클라이언트를 추가하되 기존 것은 살려둬,
     * 파트너가 전환하는 동안 옛 시크릿도 계속 통하게 한다.
     */
    async beginRotation(partnerId: string, actor: string): Promise<PartnerCredential> {
      assertPartnerId(partnerId)
      const clients = await loadClients(partnerId)
      const current = clients[0]
      if (!current) throw new PartnerError(`등록되지 않은 파트너다: ${partnerId}`, 404)
      if (clients.length > 1) {
        throw new PartnerError('이미 회전 중이다. 먼저 완료하거나 취소해야 한다', 409)
      }

      const view = toView(current)
      const credential = await issue(partnerId, view.generation + 1, view.scopes, view.audiences)
      audit({
        action: 'partner.rotation.begin',
        partnerId,
        actor,
        result: 'ok',
        detail: { from: current.client_id, to: credential.clientId },
      })
      return credential
    },

    /** 회전을 마무리한다. 최신 세대만 남기고 이전 세대를 폐기한다. */
    async completeRotation(partnerId: string, actor: string): Promise<PartnerView> {
      assertPartnerId(partnerId)
      const clients = await loadClients(partnerId)
      if (clients.length === 0) throw new PartnerError(`등록되지 않은 파트너다: ${partnerId}`, 404)
      if (clients.length === 1) throw new PartnerError('진행 중인 회전이 없다', 409)

      const [keep, ...retire] = clients
      for (const client of retire) {
        await hydra.deleteClient(client.client_id)
      }
      audit({
        action: 'partner.rotation.complete',
        partnerId,
        actor,
        result: 'ok',
        detail: { kept: keep!.client_id, retired: retire.map((c) => c.client_id) },
      })
      return { partnerId, clients: [toView(keep!)], rotationInProgress: false }
    },

    /** 유출 등 사고 대응. 겹침 없이 파트너의 모든 클라이언트를 즉시 폐기한다. */
    async revoke(partnerId: string, actor: string, reason: string): Promise<{ revoked: string[] }> {
      assertPartnerId(partnerId)
      const clients = await loadClients(partnerId)
      if (clients.length === 0) throw new PartnerError(`등록되지 않은 파트너다: ${partnerId}`, 404)

      for (const client of clients) {
        await hydra.deleteClient(client.client_id)
      }
      const revoked = clients.map((c) => c.client_id)
      audit({ action: 'partner.revoke', partnerId, actor, result: 'ok', detail: { revoked, reason } })
      return { revoked }
    },

    async get(partnerId: string): Promise<PartnerView> {
      assertPartnerId(partnerId)
      const clients = await loadClients(partnerId)
      if (clients.length === 0) throw new PartnerError(`등록되지 않은 파트너다: ${partnerId}`, 404)
      return {
        partnerId,
        clients: clients.map(toView),
        rotationInProgress: clients.length > 1,
      }
    },
  }
}

export type PartnerService = ReturnType<typeof createPartnerService>
