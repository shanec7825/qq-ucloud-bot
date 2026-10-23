// Do not log model text, media bytes, URLs, credentials or raw provider errors.
export function reportDeliveryIssue(kind, error = {}) {
  console.error('[QQ delivery] ' + JSON.stringify({ kind,
    ...(typeof error.code === 'string' && /^[A-Z0-9_]{1,60}$/.test(error.code) ? { code: error.code } : {}),
    ...(Number.isFinite(error.retcode) ? { retcode: error.retcode } : {}),
    ...(error.deliveryUnknown ? { deliveryUnknown: true } : {}),
  }));
}
