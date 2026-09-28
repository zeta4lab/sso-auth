import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  ADMIN_API_TOKEN: z.string().min(16, 'ADMIN_API_TOKEN은 16자 이상이어야 한다'),
  HYDRA_ADMIN_URL: z.string().url(),
  HYDRA_PUBLIC_URL: z.string().url(),
})

export type Config = {
  port: number
  adminApiToken: string
  hydraAdminUrl: string
  hydraPublicUrl: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env)
  return {
    port: parsed.PORT,
    adminApiToken: parsed.ADMIN_API_TOKEN,
    hydraAdminUrl: parsed.HYDRA_ADMIN_URL.replace(/\/+$/, ''),
    hydraPublicUrl: parsed.HYDRA_PUBLIC_URL.replace(/\/+$/, ''),
  }
}
