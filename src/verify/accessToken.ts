import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

export type AccessTokenClaims = {
  clientId: string
  scopes: string[]
  audience: string[]
  expiresAt: Date
}

export class AccessTokenError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
    readonly code: 'invalid_token' | 'insufficient_scope',
  ) {
    super(message)
    this.name = 'AccessTokenError'
  }
}

export type VerifierOptions = {
  /** Hydra 공개 issuer. 토큰의 iss와 정확히 일치해야 한다. */
  issuer: string
  /** 이 리소스 서버의 audience. 다른 API용 토큰은 거부된다. */
  audience: string
  /** 기본은 issuer의 JWKS 엔드포인트. 테스트에서 로컬 키셋을 주입한다. */
  jwks?: JWTVerifyGetKey
  clockToleranceSeconds?: number
}

/**
 * 액세스 토큰을 JWKS로 로컬 검증한다.
 * 토큰 서버에 매 요청 묻지 않으므로 Hydra가 잠시 죽어도 기존 토큰은 계속 통과한다.
 * 대가로 폐기는 즉시 반영되지 않는다(남은 TTL 동안 유효).
 */
export function createAccessTokenVerifier(options: VerifierOptions) {
  const issuer = options.issuer.replace(/\/+$/, '')
  const jwks = options.jwks ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))

  return async function verify(token: string): Promise<AccessTokenClaims> {
    let payload
    try {
      const result = await jwtVerify(token, jwks, {
        issuer,
        audience: options.audience,
        clockTolerance: options.clockToleranceSeconds ?? 5,
      })
      payload = result.payload
    } catch (cause) {
      throw new AccessTokenError(`액세스 토큰 검증 실패: ${(cause as Error).message}`, 401, 'invalid_token')
    }

    const clientId = typeof payload.client_id === 'string' ? payload.client_id : payload.sub
    if (!clientId) {
      throw new AccessTokenError('토큰에 client_id도 sub도 없다', 401, 'invalid_token')
    }
    if (payload.exp === undefined) {
      throw new AccessTokenError('만료 없는 토큰은 받지 않는다', 401, 'invalid_token')
    }

    const rawScope = payload.scope ?? payload.scp
    const scopes =
      typeof rawScope === 'string'
        ? rawScope.split(' ').filter(Boolean)
        : Array.isArray(rawScope)
          ? rawScope.filter((s): s is string => typeof s === 'string')
          : []

    return {
      clientId,
      scopes,
      audience: typeof payload.aud === 'string' ? [payload.aud] : (payload.aud ?? []),
      expiresAt: new Date(payload.exp * 1000),
    }
  }
}

export type AccessTokenVerifier = ReturnType<typeof createAccessTokenVerifier>

/** 필요한 스코프를 모두 가지고 있어야 통과한다. */
export function requireScopes(claims: AccessTokenClaims, required: string[]): void {
  const missing = required.filter((scope) => !claims.scopes.includes(scope))
  if (missing.length > 0) {
    throw new AccessTokenError(`스코프가 부족하다: ${missing.join(', ')}`, 403, 'insufficient_scope')
  }
}

export function bearerToken(authorization: string | undefined): string {
  const match = /^Bearer (.+)$/.exec(authorization ?? '')
  if (!match?.[1]) {
    throw new AccessTokenError('Authorization: Bearer 헤더가 없다', 401, 'invalid_token')
  }
  return match[1]
}
