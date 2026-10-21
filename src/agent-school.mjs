import { createHash } from 'node:crypto';

// Verified against the public student MyAssignment component and DLM+ API module:
// https://ucloud.bupt.edu.cn/uclass/static/js/49.82497c0523bf44da63d7.js
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = value => { const result = String(value ?? ''); if (!/^\d{1,30}$/.test(result)) throw new Error('学校作业或用户 ID 无效。'); return result; };
const snapshot = view => ({ content: view.assignmentContent, attachments: view.attachmentIds, commitId: view.commitId ?? '', status: view.status, assignmentStatus: view.assignmentStatus, overtime: view.isOvertimeCommit });
const editable = view => (view.status === 2 && [0, 2, 99].includes(view.assignmentStatus)) || (view.status === 3 && [2, 99].includes(view.assignmentStatus) && view.isOvertimeCommit === 0);

export class AgentSchool {
  constructor(client, { getUserId } = {}) {
    this.client = client;
    this.getUserId = getUserId;
    this.plans = new WeakMap();
  }
  async state(assignmentId) {
    const detail = (await this.client.request('/ykt-site/work/detail?assignmentId=' + assignmentId)).data;
    const view = (await this.client.request('/ykt-site/work/submit-view?assignmentId=' + assignmentId)).data;
    if (!detail?.assignmentTitle || Number(detail.assignmentType) !== 0) throw new Error('目前仅支持个人文字作业；小组作业需在教学云操作。');
    if (!view || typeof view.assignmentContent !== 'string' || !Array.isArray(view.attachmentIds) || !editable(view)) throw new Error('作业当前不可提交或学校字段已变化，请在教学云检查。');
    return { detail, view };
  }
  async prepare({ assignmentId, content, attachments = [] }) {
    assignmentId = id(assignmentId);
    if (!Array.isArray(attachments) || attachments.length) throw new Error('尚未验证学校附件上传协议；请在教学云上传 QQ 文件。');
    if (typeof content !== 'string' || !content.trim() || content.length > 2000) throw new Error('文字作业须为 1–2000 字符。');
    content = content.replace(/[\s\n\t]+$/g, '');
    if (typeof this.getUserId !== 'function') throw new Error('学校身份未配置。');
    const userId = id(await this.getUserId());
    const { detail, view } = await this.state(assignmentId);
    if (view.attachmentIds.length) throw new Error('已有学校附件，请在教学云修改以避免覆盖附件。');
    const payload = { attachmentIds: [], assignmentContent: content, assignmentId, assignmentType: 0, userId, groupId: '', commitId: view.commitId ?? '' };
    Object.freeze(payload.attachmentIds); Object.freeze(payload);
    const plan = Object.freeze({ assignmentId, title: String(detail.assignmentTitle), content, payload, fingerprint: digest(payload) });
    this.plans.set(plan, { baseline: digest(snapshot(view)), userId, detail: digest(detail), used: false });
    return plan;
  }
  async submit(plan, { beforeWrite = () => {} } = {}) {
    const entry = this.plans.get(plan);
    if (!entry || entry.used || digest(plan.payload) !== plan.fingerprint) throw new Error('提交预览无效或已使用，请重新预览并确认。');
    entry.used = true;
    if (id(await this.getUserId()) !== entry.userId) throw new Error('学校登录身份已变化，请重新确认。');
    const { detail, view } = await this.state(plan.assignmentId);
    if (digest(snapshot(view)) !== entry.baseline || digest(detail) !== entry.detail) throw new Error('学校作业已变化，请重新预览并确认。');
    if (id(await this.getUserId()) !== entry.userId) throw new Error('学校登录身份已变化，请重新确认。');
    beforeWrite();
    // Never retry a write: a transport failure may occur after the school commits it.
    try { await this.client.request('/ykt-site/work/submit', plan.payload, false); }
    catch { return { status: 'unknown', message: '提交结果不确定，请先在教学云核对，勿重复提交。' }; }
    try {
      const current = (await this.client.request('/ykt-site/work/submit-view?assignmentId=' + plan.assignmentId)).data;
      if (current?.assignmentContent === plan.content && Array.isArray(current.attachmentIds) && current.attachmentIds.length === 0 && current.assignmentStatus === 0) return { status: 'verified', assignmentId: plan.assignmentId, title: plan.title, message: '学校已保存，回读内容一致。' };
    } catch {}
    return { status: 'unknown', message: '学校接受了请求，但未核实最终提交状态，请在教学云核对。' };
  }
}
