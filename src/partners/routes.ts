import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PartnerError, type PartnerService } from './service.ts'

const registerBody = z.object({
  partnerId: z.string(),
  scopes: z.array(z.string()).min(1),
  audiences: z.array(z.string()).min(1),
})

const revokeBody = z.object({ reason: z.string().min(1) })

const params = z.object({ partnerId: z.string() })

/** 관리 API는 운영자만 호출한다. 파트너에게 노출하지 않는다. */
export function partnerRoutes(partners: PartnerService, adminApiToken: string) {
  return async function routes(app: FastifyInstance) {
    app.addHook('preHandler', async (request, reply) => {
      const presented = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1]
      if (!presented || !timingSafeEquals(presented, adminApiToken)) {
        await reply.code(401).send({ error: 'unauthorized' })
      }
    })

    app.setErrorHandler(async (error, request, reply) => {
      if (error instanceof PartnerError) {
        await reply.code(error.status).send({ error: 'partner_error', message: error.message })
        return
      }
      if (error instanceof z.ZodError) {
        await reply.code(400).send({ error: 'invalid_request', issues: error.issues })
        return
      }
      request.log.error({ err: error }, '관리 API 처리 실패')
      await reply.code(500).send({ error: 'internal_error' })
    })

    app.post('/partners', async (request, reply) => {
      const body = registerBody.parse(request.body)
      const actor = actorOf(request.headers['x-actor'])
      const credential = await partners.register(body.partnerId, body.scopes, body.audiences, actor)
      // client_secret은 여기서만 보인다. 저장하지 않으며 다시 조회할 수 없다.
      await reply.code(201).send(credential)
    })

    app.get('/partners/:partnerId', async (request) => {
      const { partnerId } = params.parse(request.params)
      return partners.get(partnerId)
    })

    app.post('/partners/:partnerId/rotations', async (request, reply) => {
      const { partnerId } = params.parse(request.params)
      const credential = await partners.beginRotation(partnerId, actorOf(request.headers['x-actor']))
      await reply.code(201).send(credential)
    })

    app.post('/partners/:partnerId/rotations/complete', async (request) => {
      const { partnerId } = params.parse(request.params)
      return partners.completeRotation(partnerId, actorOf(request.headers['x-actor']))
    })

    app.post('/partners/:partnerId/revocation', async (request) => {
      const { partnerId } = params.parse(request.params)
      const body = revokeBody.parse(request.body)
      return partners.revoke(partnerId, actorOf(request.headers['x-actor']), body.reason)
    })
  }
}

function actorOf(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header
  return value && value.trim() !== '' ? value : 'unknown'
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
