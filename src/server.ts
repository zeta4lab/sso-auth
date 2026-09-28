import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config.ts'
import { createAuditLog, type AuditSink } from './audit/log.ts'
import { createHydraAdmin, type HydraAdmin } from './hydra/adminClient.ts'
import { createPartnerService } from './partners/service.ts'
import { partnerRoutes } from './partners/routes.ts'

export type ServerDeps = {
  hydra?: HydraAdmin
  auditSink?: AuditSink
}

export function buildServer(config: Config, deps: ServerDeps = {}): FastifyInstance {
  const app = Fastify({ logger: true })
  const hydra = deps.hydra ?? createHydraAdmin(config.hydraAdminUrl)
  const audit = createAuditLog(deps.auditSink)
  const partners = createPartnerService(hydra, audit)

  app.get('/healthz', async () => ({ status: 'ok' }))
  app.register(partnerRoutes(partners, config.adminApiToken), { prefix: '/admin' })

  return app
}
