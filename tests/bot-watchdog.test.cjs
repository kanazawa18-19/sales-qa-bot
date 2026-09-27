const {test} = require('node:test');
const assert = require('node:assert/strict');
const recover = require('../scripts/bot_watchdog.cjs');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');

function fixture(active, fail) {
  const calls = [];
  const actions = {
    async listWorkflowRuns(args) {
      calls.push(['GET', args]);
      if (fail) throw new Error('通信失敗');
      return {data: {total_count: args.status === active ? 200 : 0,
        workflow_runs: args.status === active ? [{id: 1}] : []}};
    },
    async createWorkflowDispatch(args) { calls.push(['POST', args]); },
  };
  return {calls, actions, input: {github: {rest: {actions}},
    context: {ref: 'refs/heads/main', repo: {owner: 'example', repo: 'test'}},
    core: {info() {}}}};
}

for (const state of ['in_progress', 'queued', 'pending', 'waiting', 'requested']) {
  test(`${state}のrunがあれば復旧要求しない`, async () => {
    const f = fixture(state);
    assert.equal(await recover(f.input), 'skipped');
    assert.equal(f.calls.some(([method]) => method === 'POST'), false);
  });
}

test('全状態に未完了runがなければmainへ1回だけ起動要求する', async () => {
  const f = fixture();
  assert.equal(await recover(f.input), 'requested');
  assert.equal(f.calls.filter(([method]) => method === 'GET').length, 5);
  const posts = f.calls.filter(([method]) => method === 'POST');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0][1], {owner: 'example', repo: 'test', workflow_id: 'bot.yml', ref: 'main'});
  for (const [, args] of f.calls.slice(0, 5)) assert.equal(args.branch, 'main');
});

test('API失敗時には起動しない', async () => {
  const f = fixture(null, true);
  await assert.rejects(recover(f.input));
  assert.equal(f.calls.length, 1);
});

test('不明な応答を停止と見なさない', async () => {
  for (const data of [{}, {total_count: -1, workflow_runs: []},
    {total_count: 0, workflow_runs: [{}]}, {total_count: 1, workflow_runs: []}]) {
    const f = fixture();
    f.actions.listWorkflowRuns = async () => ({data});
    await assert.rejects(recover(f.input), /BOT_STATE_UNKNOWN/);
    assert.equal(f.calls.length, 0);
  }
});

test('非mainからは読取も起動もしない', async () => {
  const f = fixture();
  f.input.context.ref = 'refs/heads/slack-http';
  await assert.rejects(recover(f.input), /MAIN_ONLY/);
  assert.equal(f.calls.length, 0);
});

test('起動POSTの結果不明を再送しない', async () => {
  const f = fixture();
  let posts = 0;
  f.actions.createWorkflowDispatch = async () => { posts++; throw new Error('応答消失'); };
  await assert.rejects(recover(f.input));
  assert.equal(posts, 1);
});

test('確認直後の自己再起動と重なっても取消APIを使わない', async () => {
  const f = fixture();
  let selfRestartVisible = false;
  const list = f.actions.listWorkflowRuns;
  f.actions.listWorkflowRuns = async (args) => {
    const result = await list(args);
    if (args.status === 'requested') selfRestartVisible = true;
    return result;
  };
  await recover(f.input);
  assert.equal(selfRestartVisible, true);
  // 読取後の競合では余分なPOSTがあり得る。実機の直列化を再現するテストではない。
  assert.equal(f.calls.filter(([method]) => method === 'POST').length, 1);
});

test('Botと停止確認の実行枠・取消設定・旧時計削除を保持する', () => {
  const read = (file) => readFileSync(join(__dirname, '..', '.github/workflows', file), 'utf8');
  const bot = read('bot.yml');
  const watchdog = read('bot-watchdog.yml');
  assert.doesNotMatch(bot, /^  schedule:/m);
  assert.match(bot, /^  cancel-in-progress: false$/m);
  assert.match(bot, /github\.ref == 'refs\/heads\/main' && 'sales-qa-bot'/);
  assert.match(bot, /if: \$\{\{ !cancelled\(\) \}\}/);
  assert.match(bot, /"ref":"main"/);
  assert.match(watchdog, /^  group: sales-qa-bot-watchdog$/m);
  assert.match(watchdog, /^  cancel-in-progress: false$/m);
  assert.match(watchdog, /if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}/);
  assert.match(watchdog, /retries: 0/);
});
