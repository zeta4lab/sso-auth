import { describe, expect, it } from 'vitest'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import {
  AccessTokenError,
  bearerToken,
  createAccessTokenVerifier,
  requireScopes,
} from '../src/verify/accessToken.ts'

const ISSUER = 'https://auth.example.com'
const AUDIENCE = 'https://api.example.com'

const { privateKey, publicKey } = await generateKeyPair('RS256')
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }
const jwks = createLocalJWKSet({ keys: [publicJwk] })

async function signToken(overrides: {
  issuer?: string
  audience?: string
  scope?: string
  expiresIn?: string
  clientId?: string | null
} = {}) {
  let token = new SignJWT({
    scope: overrides.scope ?? 'reports:read',
    ...(overrides.clientId === null ? {} : { client_id: overrides.clientId ?? 'partner-a-g1' }),
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setSubject('partner-a-g1')
  token = token.setExpirationTime(overrides.expiresIn ?? '15m')
  return token.sign(privateKey)
}

const verify = createAccessTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks })

describe('액세스 토큰 검증', () => {
  it('정상 토큰의 클레임을 돌려준다', async () => {
    const claims = await verify(await signToken({ scope: 'reports:read reports:write' }))
    expect(claims.clientId).toBe('partner-a-g1')
    expect(claims.scopes).toEqual(['reports:read', 'reports:write'])
    expect(claims.audience).toEqual([AUDIENCE])
    expect(claims.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('다른 API용 토큰(aud 불일치)은 거부한다', async () => {
    await expect(verify(await signToken({ audience: 'https://other.example.com' }))).rejects.toThrow(
      AccessTokenError,
    )
  })

  it('issuer가 다르면 거부한다', async () => {
    await expect(verify(await signToken({ issuer: 'https://evil.example.com' }))).rejects.toThrow(
      AccessTokenError,
    )
  })

  it('만료된 토큰은 거부한다', async () => {
    await expect(verify(await signToken({ expiresIn: '-1m' }))).rejects.toMatchObject({ status: 401 })
  })

  it('다른 키로 서명된 토큰은 거부한다', async () => {
    const other = await generateKeyPair('RS256')
    const forged = await new SignJWT({ scope: 'reports:read', client_id: 'partner-a-g1' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('15m')
      .sign(other.privateKey)
    await expect(verify(forged)).rejects.toThrow(AccessTokenError)
  })

  it('client_id가 없으면 sub를 주체로 쓴다', async () => {
    const claims = await verify(await signToken({ clientId: null }))
    expect(claims.clientId).toBe('partner-a-g1')
  })
})

describe('스코프 강제', () => {
  const claims = { clientId: 'c', scopes: ['reports:read'], audience: [AUDIENCE], expiresAt: new Date() }

  it('필요한 스코프를 모두 가지면 통과한다', () => {
    expect(() => requireScopes(claims, ['reports:read'])).not.toThrow()
  })

  it('부족하면 403 insufficient_scope', () => {
    try {
      requireScopes(claims, ['reports:read', 'reports:write'])
      throw new Error('통과하면 안 된다')
    } catch (error) {
      expect(error).toBeInstanceOf(AccessTokenError)
      expect((error as AccessTokenError).status).toBe(403)
      expect((error as AccessTokenError).code).toBe('insufficient_scope')
    }
  })
})

describe('Bearer 헤더 파싱', () => {
  it('토큰을 꺼낸다', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
  })

  it('헤더가 없거나 형식이 다르면 401', () => {
    expect(() => bearerToken(undefined)).toThrow(AccessTokenError)
    expect(() => bearerToken('Basic abc')).toThrow(AccessTokenError)
  })
})
