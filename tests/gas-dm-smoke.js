// 本人DM限定の手動試験。Core+Mainと一時配置し、終了後GASから除去する。
// 質問をbotが作るため、ユーザー投稿の検出・定期巡回の試験ではない。
function smokeSalesQaOwnerDm() {
    var c = config_(), props = PropertiesService.getScriptProperties();
    var channel = 'D0B87Q9U54G', owner = 'U03JFKXG6C8';
    if (c.p.ENABLED !== 'false' || ScriptApp.getProjectTriggers().length ||
        c.qa !== channel || c.ai !== channel || c.botUser !== 'U0B87Q9P99N' ||
        c.p.GOOGLE_SPREADSHEET_ID !== '1q6MRXp8R_pYMjaZcosCVRAh6CfpuATohUXezgh-CKfQ' ||
        c.p.GOOGLE_SHEET_NAME !== 'GAS_TEST_QA')
        throw new Error('SMOKE_TARGET_MISMATCH');
    var auth = slack_(c, 'auth.test', {});
    var info = slack_(c, 'conversations.info', {channel: channel});
    if (auth.user_id !== owner || !info.channel.is_im || info.channel.user !== c.botUser)
        throw new Error('SMOKE_OWNER_DM_MISMATCH');
    var b = book_(c);
    if (rows_(sheet_(b, 'CORRECTIONS')).length > 1 ||
        rows_(sheet_(b, 'GAS_TEST_QA')).slice(1).some(function (r) {
            return r[8] !== '1790442578.000001';
        })) throw new Error('SMOKE_CONTEXT_NOT_SYNTHETIC');
    // 実資料は読み込まず、今回の呼出し内だけ架空資料へ切り替える。
    c.p = Object.assign({}, c.p, {NOTEBOOKLM_MIGRATION_ACK: 'true',
        SERVICE_MATERIALS_FILE_ID: '',
        SERVICE_MATERIALS_TEXT: '架空サービス「テストプラン青」の月額料金は1,234円です。実在の顧客・サービスではありません。'});
    var question = '【GAS移行テスト・架空】テストプラン青の月額料金はいくらですか？\n金沢さんのDMだけで、GASからの返信と重複防止を確認しています。';
    var ts = props.getProperty('SMOKE_DM_PARENT_TS');
    if (!ts) {
        if (props.getProperty('SMOKE_DM_PARENT_PENDING'))
            throw new Error('SMOKE_PARENT_RECONCILE');
        props.setProperty('SMOKE_DM_PARENT_PENDING', 'true');
        var posted = slack_(c, 'chat.postMessage', {channel: channel, text: question}, true);
        if (posted.channel !== channel || !posted.ts)
            throw new Error('SMOKE_PARENT_VERIFY');
        ts = posted.ts;
        props.setProperty('SMOKE_DM_PARENT_TS', ts);
        props.deleteProperty('SMOKE_DM_PARENT_PENDING');
    }
    var thread = slack_(c, 'conversations.replies', {channel: channel, ts: ts, limit: 15});
    var parent = thread.messages && thread.messages[0];
    if (!parent || parent.ts !== ts || parent.user !== c.botUser || parent.text !== question)
        throw new Error('SMOKE_PARENT_VERIFY');
    answer_(c, b, channel, parent, thread.messages);
    // 同じ質問の処理をもう一度呼び、通常の送信台帳による二重返信防止を確認する。
    answer_(c, b, channel, parent, thread.messages);
    var after = slack_(c, 'conversations.replies', {channel: channel, ts: ts, limit: 15});
    var replies = after.messages.filter(function (m) { return m.ts !== ts && m.user === c.botUser; });
    if (replies.length !== 1 || !/1,?234/.test(replies[0].text))
        throw new Error('SMOKE_REPLY_COUNT_OR_CONTENT');
    console.log(JSON.stringify({ownerOnly: true, syntheticQuestion: true,
        incomingPollingTested: false, channel: channel, parentTs: ts,
        replyTs: replies[0].ts, replyCount: replies.length,
        duplicatePrevented: true, answer: replies[0].text}));
}
