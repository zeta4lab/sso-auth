import { loadConfig } from './config.ts'
import { buildServer } from './server.ts'

const config = loadConfig()
const app = buildServer(config)

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
} catch (error) {
  app.log.error({ err: error }, '서버 기동 실패')
  process.exit(1)
}
