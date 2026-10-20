export function sessionFromRequest(address, headers) {
  const url = new URL(address);
  const supported = ['/ykt-site/site/student/undone', '/ykt-site/site/list/student/current'];
  if (url.origin !== 'https://apiucloud.bupt.edu.cn' || !supported.includes(url.pathname)) return null;
  const userId = url.searchParams.get('userId');
  if (!userId || !headers['blade-auth']) return null;
  return { userId, headers: Object.fromEntries(['authorization', 'blade-auth', 'identity', 'tenant-id'].filter(key => headers[key]).map(key => [key, headers[key]])) };
}

export function successfulSchoolResponse(status, json) {
  return status >= 200 && status < 300 && json?.success !== false &&
    (json?.code == null || [0, 200].includes(Number(json.code))) &&
    (Array.isArray(json?.data?.undoneList) || Array.isArray(json?.data?.records));
}
