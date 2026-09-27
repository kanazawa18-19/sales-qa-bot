// 未完了runがある限り触らない。競合による二重稼働をbot.ymlの共通実行枠で防ぐ。
const ACTIVE_STATUSES = ['in_progress', 'queued', 'pending', 'waiting', 'requested'];

module.exports = async function recover({github, context, core}) {
  if (context.ref !== 'refs/heads/main') throw new Error('MAIN_ONLY');
  const target = {...context.repo, workflow_id: 'bot.yml'};
  for (const status of ACTIVE_STATUSES) {
    const {data} = await github.rest.actions.listWorkflowRuns({
      ...target, branch: 'main', status, per_page: 1,
    });
    // 不明な応答を「停止」と解釈しない。本文や認証値をログへ出さない。
    if (!Number.isInteger(data?.total_count) || data.total_count < 0 ||
        !Array.isArray(data.workflow_runs) ||
        (data.total_count === 0) !== (data.workflow_runs.length === 0)) {
      throw new Error('BOT_STATE_UNKNOWN');
    }
    if (data.total_count > 0) {
      core.info(`BOT_RECOVERY_SKIPPED status=${status}`);
      return 'skipped';
    }
  }
  // 結果不明のPOSTをこの実行内で再送しない。次の定期確認で状態を読み直す。
  await github.rest.actions.createWorkflowDispatch({...target, ref: 'main'});
  core.info('BOT_RECOVERY_REQUESTED');
  return 'requested';
};
