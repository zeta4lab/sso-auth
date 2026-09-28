export {
  AccessTokenError,
  bearerToken,
  createAccessTokenVerifier,
  requireScopes,
  type AccessTokenClaims,
  type AccessTokenVerifier,
  type VerifierOptions,
} from './accessToken.ts'
export { protect } from './fastifyPlugin.ts'
