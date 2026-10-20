import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromRequest, successfulSchoolResponse } from '../src/capture-session.mjs';

test('学校首页和课程列表均可捕获，精确校验主机并只保留必要请求头', () => {
  for (const path of ['/ykt-site/site/student/undone', '/ykt-site/site/list/student/current']) {
    assert.deepEqual(sessionFromRequest('https://apiucloud.bupt.edu.cn' + path + '?userId=1234567890123456789', { 'blade-auth': 'fake', cookie: 'secret', authorization: 'Basic fake' }), {
      userId: '1234567890123456789', headers: { authorization: 'Basic fake', 'blade-auth': 'fake' },
    });
  }
  assert.equal(sessionFromRequest('https://apiucloud.bupt.edu.cn.evil.example/ykt-site/site/student/undone?userId=1', { 'blade-auth': 'fake' }), null);
  assert.equal(sessionFromRequest('https://apiucloud.bupt.edu.cn/ykt-site/site/student/undone', { 'blade-auth': 'fake' }), null);
});

test('仅保存已成功返回学校数据的登录态，登录过期或错误响应继续等待', () => {
  assert.equal(successfulSchoolResponse(200, { code: 200, data: { records: [] } }), true);
  assert.equal(successfulSchoolResponse(200, { success: true, data: { undoneList: [] } }), true);
  assert.equal(successfulSchoolResponse(401, { data: { records: [] } }), false);
  assert.equal(successfulSchoolResponse(200, { code: 401 }), false);
  assert.equal(successfulSchoolResponse(200, { success: false, data: { records: [] } }), false);
  assert.equal(successfulSchoolResponse(200, {}), false);
});
