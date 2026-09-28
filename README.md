# sso-auth

외부 파트너를 포함한 **서버 간 호출(M2M) 인증**. 토큰 발급은 [Ory Hydra](https://www.ory.sh/hydra/)가 하고,
이 저장소는 파트너 관리·인가 정책·토큰 검증 라이브러리를 맡는다.

배경과 결정 근거는 [`docs/`](docs/README.md)에 있다. **문서를 먼저 확정하고 코드를 쓴다.**

## 구성

- `src/partners` — 파트너 등록, 시크릿 무중단 회전, 즉시 폐기 (운영자용 관리 API)
- `src/hydra` — Hydra Admin API 연동
- `src/verify` — 리소스 서버가 쓰는 액세스 토큰 검증 (JWKS 로컬 검증 + 스코프 강제)
- `src/audit` — 감사 로그 (시크릿은 절대 담지 않는다)
- `deploy/docker-compose.yml` — 로컬 Hydra (**아직 실행 검증 안 됨**)

## 개발

```bash
npm install
npm test        # 28개 테스트, 실제 Hydra 없이 동작
npm run typecheck
npm run build
```

`.env.example`을 `.env`로 복사해 값을 채운다. `ADMIN_API_TOKEN`은 16자 이상이어야 한다.

## 관리 API

모든 요청에 `Authorization: Bearer <ADMIN_API_TOKEN>`이 필요하다. `X-Actor` 헤더는 감사 로그에 남는다.
**이 API는 운영자 전용이며 파트너에게 노출하지 않는다.**

| 요청 | 하는 일 |
| --- | --- |
| `POST /admin/partners` | 파트너 등록. 응답의 `clientSecret`은 **이때만** 볼 수 있다 |
| `GET /admin/partners/:id` | 현재 클라이언트 세대와 회전 진행 여부 |
| `POST /admin/partners/:id/rotations` | 회전 시작. 새 시크릿 발급, 옛 시크릿도 계속 유효 |
| `POST /admin/partners/:id/rotations/complete` | 회전 완료. 이전 세대 폐기 |
| `POST /admin/partners/:id/revocation` | 사고 대응. 모든 세대 즉시 폐기 (`reason` 필수) |

```bash
curl -X POST localhost:8080/admin/partners \
  -H "authorization: Bearer $ADMIN_API_TOKEN" \
  -H 'x-actor: operator@example.com' \
  -H 'content-type: application/json' \
  -d '{"partnerId":"acme","scopes":["reports:read"],"audiences":["https://api.example.com"]}'
```

## 리소스 서버에서 토큰 검증

```ts
import { createAccessTokenVerifier, protect } from 'sso-auth/verify'

const verify = createAccessTokenVerifier({
  issuer: 'https://auth.example.com',
  audience: 'https://api.example.com', // 내 API용이 아닌 토큰은 거부된다
})

app.get('/reports', { preHandler: protect(verify, ['reports:read']) }, async (request) => {
  return { calledBy: request.accessToken!.clientId }
})
```

JWKS로 로컬 검증하므로 Hydra가 잠시 죽어도 기존 토큰의 호출은 계속 통과한다.
대신 폐기는 남은 TTL(기본 15분) 뒤에 반영된다 — 그 절충은 [`docs/architecture.md`](docs/architecture.md) 참고.

## 아직 안 된 것

- Hydra를 실제로 띄운 종단 검증 (이 환경에 Docker가 없다)
- 파트너 셀프서비스 온보딩, 레이트 리밋, 즉시 폐기 경로
- 운영 수치 확정 (TTL, 키 회전 주기, 로그 보관) — [논의 아젠다](docs/discussion-agenda.md) 4번
