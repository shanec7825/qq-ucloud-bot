// Routes used by UCloud's student homepage tapUndone handler (2026-10-23).
// These links open the official page; they never submit an assignment themselves.
const base = 'https://ucloud.bupt.edu.cn/uclass/';
const numericId = value => (typeof value === 'string' || Number.isSafeInteger(value)) && /^[1-9]\d{0,29}$/.test(String(value)) ? String(value) : null;
const flag = (value, fallback = 0) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 10 ? String(Number(value)) : String(fallback);

export function schoolTaskAction(task) {
  const id = numericId(task?.id);
  if (!id) return null;
  const type = Number(task.type);
  const url = new URL(type === 2 ? './' : 'course.html', base);
  let route, label;
  const query = new URLSearchParams();
  if (type === 3 || type === 5) {
    route = '/student/assignmentDetails_fullpage';
    label = type === 3 ? '前往提交' : '前往互评';
    query.set('activeTabName', type === 3 ? 'first' : 'fourth');
    query.set('assignmentId', id);
    query.set('assignmentType', flag(task.assignmentType));
    query.set('assignmentTitle', String(task.title || '').slice(0, 500));
    query.set('evaluationStatus', flag(task.evaluationStatus));
    query.set('isOpenEvaluation', flag(task.isOpenEvaluation));
    const group = numericId(task.studentGroupId);
    if (group) query.set('studentGroupId', group);
  } else if (type === 4 || type === 2) {
    route = type === 4 ? '/answer' : '/student/survey/participateSurvey_fullpage';
    label = type === 4 ? '前往测验' : '前往问卷';
    query.set('id', id);
  } else return null;
  url.hash = route + '?' + query;
  return { url: url.href, label };
}
