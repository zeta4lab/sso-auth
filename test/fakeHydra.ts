import type { CreateClientInput, HydraAdmin, OAuth2Client } from '../src/hydra/adminClient.ts'

/** Hydra Admin API를 대신하는 메모리 구현. 실제 Hydra 없이 파트너 흐름을 검증한다. */
export function createFakeHydra() {
  const clients = new Map<string, OAuth2Client>()
  let secretCounter = 0

  const admin: HydraAdmin = {
    async createClient(input: CreateClientInput) {
      if (clients.has(input.clientId)) {
        throw new Error(`중복 client_id: ${input.clientId}`)
      }
      secretCounter += 1
      const client: OAuth2Client = {
        client_id: input.clientId,
        client_name: input.clientName,
        owner: input.owner,
        scope: input.scopes.join(' '),
        audience: input.audiences,
        grant_types: ['client_credentials'],
        token_endpoint_auth_method: 'client_secret_basic',
        metadata: input.metadata,
      }
      clients.set(client.client_id, client)
      // 실제 Hydra처럼 시크릿은 생성 응답에만 담고 저장본에는 남기지 않는다.
      return { ...client, client_secret: `secret-${secretCounter}` }
    },

    async listClientsByOwner(owner: string) {
      return [...clients.values()].filter((c) => c.owner === owner)
    },

    async deleteClient(clientId: string) {
      clients.delete(clientId)
    },
  }

  return { admin, clients }
}
