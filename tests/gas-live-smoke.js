// 手動検証専用。Core.js・Main.jsと同時に一時配置し、検証後はGASから除去する。
// 固定の検証先へ架空データを書き込む。Slack投稿・トリガー登録は行わない。
function smokeSalesQaSynthetic() {
    var c = config_();
    if (c.p.ENABLED !== 'false' ||
        c.p.GOOGLE_SPREADSHEET_ID !== '1q6MRXp8R_pYMjaZcosCVRAh6CfpuATohUXezgh-CKfQ' ||
        c.p.GOOGLE_SHEET_NAME !== 'GAS_TEST_QA' ||
        c.p.NOTION_DATABASE_ID !== 'e2889f13-33c2-40b1-8a17-8cad8cf25cb6' ||
        c.p.SERVICE_MATERIALS_FILE_ID ||
        c.p.SERVICE_MATERIALS_TEXT !== '架空の検証サービス「テストプラン青」の月額料金は1,234円です。実在のサービス・顧客情報ではありません。' ||
        ScriptApp.getProjectTriggers().length)
        throw new Error('SMOKE_TARGET_MISMATCH');
    var b = book_(c), s = sheet_(b, 'GAS_TEST_QA');
    var ts = '1790442578.000001';
    if (rows_(s).slice(1).some(function (r) { return r[8] !== ts; }) ||
        rows_(sheet_(b, 'CORRECTIONS')).length > 1)
        throw new Error('SMOKE_CONTEXT_NOT_EMPTY');
    var parent = {ts: ts, user: 'GAS_TEST_USER',
        text: '■サービス\n架空のテストプラン青\n■質問内容\n【架空の検証】テストプラン青の月額料金はいくらですか？\n■質問の背景や意図\nGAS接続検証。実際のSlack投稿ではありません。'};
    var answer = aiText_(c, b, parent);
    if (!/1,?234/.test(answer)) throw new Error('SMOKE_AI_ANSWER');
    // 保存経路の入力は架空の人間回答。AI投稿を記録したとの誤認を避ける。
    var messages = [parent, {ts: '1790442578.000002', user: 'GAS_TEST_REVIEWER',
        text: '【架空の人間回答】テストプラン青の月額は1,234円です。'}];
    sync_(c, b, 'GAS_SYNTHETIC_TEST', messages, '1790442579');
    var row = rows_(s).findIndex(function (r) { return r[8] === ts; }) + 1;
    rawCell_(s, row, 3, '【架空】人手で補足した背景・再同期で保持する');
    sync_(c, b, 'GAS_SYNTHETIC_TEST', messages, '1790442580');
    var data = rows_(s).slice(1);
    if (data.length !== 1 || data[0][2] !== '【架空】人手で補足した背景・再同期で保持する')
        throw new Error('SMOKE_SHEET_DUPLICATE_OR_OVERWRITE');
    var pages = notion_(c, 'data_sources/' + sourceId_(c) + '/query', {
        filter: {property: 'タイムスタンプ', rich_text: {equals: ts}}
    });
    if (pages.results.length !== 1) throw new Error('SMOKE_NOTION_COUNT');
    var result = {syntheticOnly: true, slackPosted: false, aiAnswer: answer,
        sheetRows: data.length, notionRows: pages.results.length,
        humanBackgroundPreserved: true, notionDateType: notionQuestionDateType_(c)};
    console.log(JSON.stringify(result));
    if (c.p.HEALTH_EMAIL !== 'kanazawa@cnctor.jp') throw new Error('SMOKE_EMAIL_TARGET');
    MailApp.sendEmail(c.p.HEALTH_EMAIL, 'sales-qa-bot GAS接続テスト（架空データ）',
        '架空データでAI回答生成・Sheets/Notion保存・再同期を確認しました。Slackへの返信と本番切替は未実施です。\n' + JSON.stringify(result));
}
