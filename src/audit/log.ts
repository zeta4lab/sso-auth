export type AuditEvent = {
  action: string
  partnerId: string
  actor: string
  result: 'ok' | 'error'
  detail?: Record<string, unknown>
}

export type AuditSink = (event: AuditEvent & { at: string }) => void

/** 감사 로그는 구조화된 JSON 한 줄로 남긴다. 시크릿 값은 절대 담지 않는다. */
export const stdoutSink: AuditSink = (event) => {
  process.stdout.write(JSON.stringify({ kind: 'audit', ...event }) + '\n')
}

export function createAuditLog(sink: AuditSink = stdoutSink) {
  return (event: AuditEvent) => sink({ ...event, at: new Date().toISOString() })
}

export type AuditLog = ReturnType<typeof createAuditLog>
