/** Hydra Admin API에서 이 프로젝트가 쓰는 부분만 추린 타입. */
export type OAuth2Client = {
  client_id: string
  client_secret?: string
  client_name?: string
  owner?: string
  scope?: string
  audience?: string[]
  grant_types?: string[]
  token_endpoint_auth_method?: string
  metadata?: Record<string, unknown>
}

export type CreateClientInput = {
  clientId: string
  clientName: string
  owner: string
  scopes: string[]
  audiences: string[]
  metadata: Record<string, unknown>
}

/**
 * 파트너 관리가 Hydra에 요구하는 것만 노출하는 포트.
 * 테스트는 이 인터페이스를 가짜 구현으로 갈아끼운다.
 */
export interface HydraAdmin {
  createClient(input: CreateClientInput): Promise<OAuth2Client>
  listClientsByOwner(owner: string): Promise<OAuth2Client[]>
  deleteClient(clientId: string): Promise<void>
}

export class HydraAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'HydraAdminError'
  }
}

export function createHydraAdmin(adminUrl: string, fetchImpl: typeof fetch = fetch): HydraAdmin {
  const base = adminUrl.replace(/\/+$/, '')

  async function request(path: string, init: RequestInit): Promise<Response> {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new HydraAdminError(`Hydra Admin ${init.method} ${path} 실패: ${res.status} ${body}`, res.status)
    }
    return res
  }

  return {
    async createClient(input) {
      const res = await request('/admin/clients', {
        method: 'POST',
        body: JSON.stringify({
          client_id: input.clientId,
          client_name: input.clientName,
          owner: input.owner,
          // M2M 전용: 사람이 개입하는 흐름은 허용하지 않는다.
          grant_types: ['client_credentials'],
          response_types: [],
          token_endpoint_auth_method: 'client_secret_basic',
          scope: input.scopes.join(' '),
          audience: input.audiences,
          metadata: input.metadata,
        }),
      })
      return (await res.json()) as OAuth2Client
    },

    async listClientsByOwner(owner) {
      const res = await request(`/admin/clients?owner=${encodeURIComponent(owner)}&page_size=250`, {
        method: 'GET',
      })
      const clients = (await res.json()) as OAuth2Client[]
      // owner 필터를 서버가 무시하는 배포본이 있어 클라이언트 쪽에서 한 번 더 거른다.
      return clients.filter((c) => c.owner === owner)
    },

    async deleteClient(clientId) {
      await request(`/admin/clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' })
    },
  }
}
