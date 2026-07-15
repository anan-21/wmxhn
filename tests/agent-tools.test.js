const test = require('node:test');
const assert = require('node:assert/strict');
const { TOOLS, executeTool, toClaudeTools } = require('../engine/tools');

function createSession() {
  return {
    studentProfile: {
      score: null,
      province: null,
      rank: null,
      subject: null,
      family_income: null,
      interest: null,
      city_preference: null,
      postgraduate: null,
    },
    phase: 'gathering',
    engineResult: null,
  };
}

test('tool schemas are available in both provider formats', () => {
  assert.deepEqual(
    TOOLS.map(tool => tool.function.name),
    ['update_student_profile', 'generate_recommendation', 'search_admission', 'search_knowledge', 'web_search']
  );
  assert.deepEqual(toClaudeTools().map(tool => tool.name), TOOLS.map(tool => tool.function.name));
});

test('profile tool validates and merges user facts', async () => {
  const session = createSession();
  const result = await executeTool('update_student_profile', {
    score: 600,
    province: '广东',
    subject: 'science',
    family_income: 'medium',
    rank: 40000,
  }, { session });

  assert.equal(result.ready, true);
  assert.equal(result.profile.score, 600);
  assert.equal(result.profile.province, '广东');
  assert.ok(result.changed.includes('rank'));
});

test('recommendation tool requires a complete profile', async () => {
  const result = await executeTool('generate_recommendation', {}, { session: createSession() });
  assert.equal(result.error, '画像核心信息还不完整');
});

test('recommendation tool returns compact decision layers', async () => {
  const session = createSession();
  session.studentProfile = {
    score: 600,
    rank: 40000,
    province: '广东',
    subject: 'science',
    family_income: 'medium',
    interest: '计算机',
    city_preference: true,
    postgraduate: false,
  };

  const result = await executeTool('generate_recommendation', {}, { session });
  assert.equal(result.error, undefined);
  assert.ok(result.majors.length > 0);
  assert.ok(result.schools.length > 0);
  assert.ok(result.risks.length > 0);
  assert.equal(session.phase, 'followup');
});
