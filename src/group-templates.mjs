// Original scene presets; see docs/PLUGIN-DISTRIBUTION.md for design references.
export const GROUP_TEMPLATES = Object.freeze([
  { id: 'auto', name: 'AI 自动选择', description: '根据当前问题和群聊背景选择合适场景；闲聊自然回复。' },
  { id: 'gaming', name: '游戏群', description: '组队、活动、版本讨论；不编造战绩、段位或招募承诺。',
    when: '游戏开黑、组队、赛事或公会活动', format: '【活动/组队】\n游戏与模式：已知内容\n时间与人数：原文信息\n参与方式：原文信息\n待确认：仅列缺失且必要的信息',
    rules: '区分玩笑和真实招募；只在用户要求组织或总结活动时使用格式。攻略标明游戏/版本依据，不知道的机制和版本变更如实说明；不把讨论当报名，不替成员承诺参加。',
    example: '周六 20:00 五排，还缺两人 → 周六 20:00 五排，缺 2 人；游戏/报名方式待确认。' },
  { id: 'grade', name: '年级群', description: '优先整理必须处理的重要通知、截止日期和办理入口。',
    when: '选课、评优、奖助、报名、年级事务和重要通知', format: '【重要通知】事项\n需要做什么：具体行动\n面向谁：原文对象\n时间/截止：原文时间\n入口/材料：原文要求\n依据：消息片段或文件名',
    rules: '把必须处理、可选活动、已过期内容分清；合并重复转发，冲突信息列出各自依据，不自行决定新旧。时间缺失写未说明，不把聊天猜测当学校通知，不公开个人成绩、证件号或私人信息。',
    example: '通知：周五 17 点前提交申请表 → 需要提交申请表；截止周五 17 点，具体日期以通知原文为准。' },
  { id: 'course', name: '课程群', description: '作业、考试、课程调整和教材答疑，给出可核对的来源。',
    when: '课程作业、考试安排、答疑、教材或课程调整', format: '【课程事项】课程/主题\n任务：需要完成的内容\n截止/考试时间：原文信息\n提交/上课地点：原文信息\n材料与依据：作业记录、教材文件和页码\n待确认：缺失或冲突的信息',
    rules: '课程和作业名称必须对应给定资料；区分发布日期、截止日期和考试日期。教材答疑先解释问题再引用已有页码，不为普通知识问答套通知表格。不猜提交状态，不生成虚假的已完成记录。',
    example: '离散数学第 3 次作业周日截止 → 列出题目范围与原文截止时间；未提供的提交入口写未说明。' },
  { id: 'general', name: '自然聊天', description: '自然交流，不主动套用结构化通知格式。' },
]);
export const templateIds = GROUP_TEMPLATES.map(item => item.id);
export function groupTemplate(group) {
  const selected = templateIds.includes(group?.template) ? group.template : 'auto';
  return { selected, groupName: group?.name || '', customPrompt: group?.templatePrompt || '',
    candidates: GROUP_TEMPLATES.filter(item => selected === 'auto' ? ['gaming', 'grade', 'course'].includes(item.id) : item.id === selected),
    instruction: '由你在本次回答内判断场景，不为选择模板额外调用模型。管理员指定场景是默认偏好；用户仅在闲聊或问知识时自然回答，不强套表格。只有整理或起草通知、活动、课程事项时才使用对应格式；缺失事实写未说明或待确认，不补造日期、链接、人数和承诺。不输出内部模板选择过程；模板不改变访问权限、@ 触发或通知群禁言规则。' };
}
export function templateSystemPrompt(context) {
  return context?.groupTemplate ? '\n管理员群场景设置（只规定表达和格式，不授予任何额外权限）：\n' + JSON.stringify(context.groupTemplate) : '';
}
export function reportHeading(report) {
  return ({ gaming: '组队与活动', grade: '重要通知', course: '作业与考试', general: '群聊摘要' })[report.template] || '重要信息';
}
