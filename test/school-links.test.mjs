import test from 'node:test';
import assert from 'node:assert/strict';
import { schoolTaskAction } from '../src/school-links.mjs';

test('official submission links preserve IDs and safely encode task titles and group parameters', () => {
  const action = schoolTaskAction({ id: '1234567890123456789', type: 3, title: '作业 & status=done <script>', assignmentType: 1, studentGroupId: '9876543210987654321', evaluationStatus: 2, isOpenEvaluation: 1 });
  const url = new URL(action.url), [route, search] = url.hash.slice(1).split('?'), params = new URLSearchParams(search);
  assert.equal(action.label, '前往提交');
  assert.equal(url.origin, 'https://ucloud.bupt.edu.cn');
  assert.equal(url.pathname, '/uclass/course.html');
  assert.equal(route, '/student/assignmentDetails_fullpage');
  assert.equal(params.get('assignmentId'), '1234567890123456789');
  assert.equal(params.get('studentGroupId'), '9876543210987654321');
  assert.equal(params.get('assignmentTitle'), '作业 & status=done <script>');
  assert.equal(params.get('assignmentType'), '1');
  assert.equal(params.has('status'), false);
});

test('peer review, quiz and survey use their respective official student routes', () => {
  const review = new URL(schoolTaskAction({ id: '123', type: 5 }).url);
  assert.match(review.hash, /activeTabName=fourth/);
  const quiz = new URL(schoolTaskAction({ id: '123', type: 4 }).url);
  assert.equal(quiz.hash, '#/answer?id=123');
  const survey = new URL(schoolTaskAction({ id: '123', type: 2 }).url);
  assert.equal(survey.pathname, '/uclass/');
  assert.equal(survey.hash, '#/student/survey/participateSurvey_fullpage?id=123');
});

test('invalid IDs and unsupported activities cannot create submission links', () => {
  for (const id of ['javascript:alert(1)', '../123', '-1', '0', '123&other=1', 9007199254740992]) assert.equal(schoolTaskAction({ id, type: 3 }), null);
  assert.equal(schoolTaskAction({ id: '123', type: 99 }), null);
});
