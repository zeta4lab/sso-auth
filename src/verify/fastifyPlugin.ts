import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import {
  AccessTokenError,
  bearerToken,
  requireScopes,
  type AccessTokenClaims,
  type AccessTokenVerifier,
} from './accessToken.ts'

declare module 'fastify' {
  interface FastifyRequest {
    accessToken?: AccessTokenClaims
  }
}

/**
 * 리소스 서버가 붙여 쓰는 preHandler.
 * 검증에 성공하면 request.accessToken에 클레임을 남긴다.
 */
export function protect(verifier: AccessTokenVerifier, requiredScopes: string[] = []): preHandlerHookHandler {
  return async function preHandler(request: FastifyRequest, reply: FastifyReply) {
    try {
      const claims = await verifier(bearerToken(request.headers.authorization))
      requireScopes(claims, requiredScopes)
      request.accessToken = claims
    } catch (error) {
      if (error instanceof AccessTokenError) {
        // RFC 6750: 왜 거부됐는지는 WWW-Authenticate로 알린다.
        await reply
          .code(error.status)
          .header('www-authenticate', `Bearer error="${error.code}"`)
          .send({ error: error.code, message: error.message })
        return
      }
      throw error
    }
  }
}
