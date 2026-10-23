import React from 'react';
import { Icon } from '../../shared/Icon.jsx';
import { formatNoticeItems, noticeList, noticeSenders } from '../../../src/notice-format.mjs';
import './notifications.css';

const shortName = field => field.key.split('__').at(-1);

function NoticeStage({ number, icon, title, meta, children }) {
  return <section className="notice-stage" aria-label={title}>
    <div className="notice-stage-heading"><span className="notice-stage-icon"><Icon name={icon}/></span>
      <h2>{title}</h2>{meta && <span className="notice-stage-meta">{meta}</span>}<span className="notice-stage-number" aria-hidden="true">{number}</span>
    </div>
    <div className="section-fields">{children}</div>
  </section>;
}

function FormatPreview({ realtime, template, outputFormat }) {
  const course = template === 'course', work = template === 'work';
  const sample = { title: course ? '离散数学 · 第 3 次作业' : work ? '项目评审' : '提交申请材料',
    summary: course ? '任务：完成第 3 章练习\n提交：课程平台' : work ? '行动：准备评审材料\n负责人：以原文为准' : '请按通知准备材料并提交。',
    deadlineText: '周五 17:00 前', sources: [{ groupId: realtime ? '123456789' : undefined, time: '10-22 09:30', excerpt: '请于周五 17:00 前提交材料，入口见群公告。' },
      { groupId: realtime ? '123456789' : undefined, time: '10-22 09:35', excerpt: '补充：材料请使用最新版本。' }] };
  return <figure className="notice-format-preview">
    <figcaption><span><Icon name="window"/>推送预览</span><span>本地格式示例</span></figcaption>
    <div className="notice-preview-bubble"><span className="notice-preview-heading">{realtime ? '实时重要提醒' : course ? '课程群 · 作业与考试' : work ? '项目群 · 工作事项' : '通知群 · 重要通知'}</span>
      <pre>{formatNoticeItems([sample], outputFormat)}</pre>
    </div>
    <p>仅演示排版，不调用模型或发送消息。{template === 'custom' && '自定义内容以实际整理结果为准。'}</p>
  </figure>;
}

// The parent form owns editing, validation and saving. Every schema field keeps its existing control.
export function NoticeWorkspace({ page, fields, renderField, get, busy }) {
  const realtime = page === 'realtime', assigned = new Set();
  const take = names => fields.filter(field => {
    if (!names.includes(shortName(field))) return false;
    assigned.add(field.key); return true;
  }).map(renderField);
  const source = take(realtime ? ['enabled', 'accountId', 'groups'] : ['enabled', 'groups']);
  const process = take(realtime ? ['includeKeywords', 'excludeKeywords', 'senderQQs', 'minPriority', 'focus'] : ['template', 'templatePrompt', 'focus']);
  const delivery = take(realtime ? ['recipientQQ', 'outputFormat'] : ['notify', 'recipientQQ', 'outputFormat']);
  const timing = take(realtime ? ['debounceSeconds'] : ['intervalMinutes', 'lookbackDays', 'maxMessages']);
  const remaining = fields.filter(field => !assigned.has(field.key));
  const groups = Array.isArray(get('groups')) ? get('groups').length : String(get('groups') || '').split(/[,\s]+/u).filter(Boolean).length;
  const rules = realtime ? noticeList(get('includeKeywords')).length + noticeList(get('excludeKeywords')).length + (noticeSenders(get('senderQQs')).length ? 1 : 0) : 0;
  return <div className="notice-workspace" aria-busy={busy}>
    <ol className="notice-flow" aria-label={realtime ? '即时提醒流程' : '定时整理流程'}>
      <li><Icon name="contacts"/><span>来源</span><small>{groups ? `${groups} 个群` : '待选择'}</small></li>
      <li><Icon name={realtime ? 'search' : 'sparkles'}/><span>{realtime ? '筛选' : '整理'}</span><small>{realtime ? rules ? `${rules} 项规则` : 'AI 识别' : ({ inherit: '跟随群场景', general: '通用', course: '课程', work: '工作', custom: '自定义' })[get('template') || 'inherit']}</small></li>
      <li><Icon name="check"/><span>推送</span><small>{get('recipientQQ') && (realtime || get('notify')) ? 'QQ 私聊' : realtime ? '待设置' : '保存报告'}</small></li>
    </ol>
    <NoticeStage number="01" icon="contacts" title="来源" meta={!realtime ? '默认 QQ' : undefined}>{source}</NoticeStage>
    <NoticeStage number="02" icon={realtime ? 'search' : 'sparkles'} title={realtime ? '筛选' : '整理'}>
      {process}
      {realtime && <p className="notice-field-hint">关键词用逗号或换行分隔；包含词命中任一，排除词优先。发送人填 QQ，空白不限。</p>}
    </NoticeStage>
    <NoticeStage number="03" icon="check" title="推送">{delivery}</NoticeStage>
    <FormatPreview realtime={realtime} template={get('template')} outputFormat={get('outputFormat') || (realtime ? 'detailed' : 'concise')}/>
    {timing.length > 0 && <details className="notice-runtime"><summary><Icon name="cog"/>{realtime ? '合并时机' : '检查频率与范围'}</summary><div className="section-fields">{timing}</div></details>}
    {remaining.length > 0 && <div className="section-fields">{remaining.map(renderField)}</div>}
  </div>;
}
