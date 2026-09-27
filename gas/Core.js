/* GAS と Node で共有する巡回・変換処理。 */
var SalesQa = (function () {
    function text(m) {
        if ((m.text || '').trim())
            return m.text.trim();
        function walk(x) {
            if (!x)
                return '';
            if (Array.isArray(x))
                return x.map(walk).join('\n');
            if (typeof x === 'object')
                return (typeof x.text === 'string' ? x.text : walk(x.text)) || walk(x.elements);
            return '';
        }
        return walk(m.blocks) || (m.attachments || []).map(function (a) {
            return a.text || a.pretext || '';
        }).join('\n');
    }
    function parse(s) {
        function section(label) {
            var m = s.match(new RegExp('■' + label + '\\s*\\n([\\s\\S]*?)(?=\\n■|$)'));
            return m ? m[1].trim() : '';
        }
        return {
            service: section('サービス'), question: section('質問内容') || s.trim(), background: section('質問の背景や意図')
        };
    }
    function systemMessage(m) {
        return ['channel_join', 'channel_leave', 'channel_topic', 'channel_purpose', 'channel_name', 'channel_archive', 'channel_unarchive', 'group_join', 'group_leave', 'group_topic', 'group_purpose', 'group_name', 'tombstone', 'message_deleted', 'message_changed'].indexOf(m.subtype) >= 0;
    }
    function candidate(m, channel, c) {
        if (!m.ts || Number(m.ts) < Number(c.cutoff) || m.user === c.botUser || (m.bot_id && (c.workflowBots || []).indexOf(m.bot_id) < 0) || systemMessage(m))
            return false;
        return !!text(m) && ((channel === c.ai && (!m.thread_ts || m.thread_ts === m.ts)) || (c.mentions.indexOf(channel) >= 0 && text(m).indexOf('<@' + c.botUser + '>') >= 0));
    }
    function row(channel, messages, workspace) {
        var p = messages[0], q = parse(text(p)), answers = messages.slice(1).filter(function (m) {
            return !m.bot_id && !systemMessage(m);
        });
        return [q.service, q.question, q.background, workspace + '/archives/' + channel + '/p' + p.ts.replace('.', ''), p.user || 'unknown', answers.map(function (m) {
                return m.user || '';
            }).filter(Boolean).join(', '),
            [p].concat(answers).reduce(function (a, m) {
                return a.concat((m.files || []).filter(function (f) {
                    return /^image\//.test(f.mimetype || '');
                }).map(function (f) {
                    return f.permalink || '';
                }));
            }, []).filter(Boolean).join('\n'),
            new Date(Number(p.ts) * 1000 + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '), p.ts, answers.map(text).filter(Boolean).join('\n---\n')];
    }
    // 1ステップだけ進める。失敗時は呼出側が保存しないため同じ位置を再実行する。
    function step(s, io, c) {
        var channel = c.channels[s.channel || 0];
        if (!s.latest)
            s.latest = String(io.now() / 1000);
        if (s.thread) {
            if (!s.thread.done) {
                var r;
                try {
                    r = io.replies(channel, s.thread.ts, s.thread.cursor || '', s.latest);
                }
                catch (e) {
                    if (['SLACK_THREAD_NOT_FOUND', 'SLACK_MESSAGE_NOT_FOUND'].indexOf(e.message) < 0)
                        throw e;
                    io.deleted(channel, s.thread.ts);
                    s.thread = null;
                    s.index++;
                    return s;
                }
                io.stage(r.messages || []); // 同じ ts の再保存は上書き
                s.thread.cursor = (r.response_metadata || {}).next_cursor || '';
                if (r.has_more && !s.thread.cursor)
                    throw new Error('REPLIES_CURSOR_MISSING');
                s.thread.done = !s.thread.cursor;
            }
            else {
                // 記録専用では回答候補がない。同期済みの返信を再読込しない。
                if (channel === c.qa && s.thread.synced && !c.ai && !(c.mentions || []).length) {
                    s.thread = null; s.index++; return s;
                }
                var messages = io.staged().sort(function (a, b) {
                    return Number(a.ts) - Number(b.ts);
                });
                if (!messages.length || messages[0].ts !== s.thread.ts)
                    throw new Error('THREAD_PARENT_MISSING');
                if (systemMessage(messages[0])) {
                    io.deleted(channel, s.thread.ts);
                    s.thread = null;
                    s.index++;
                    return s;
                }
                if (channel === c.qa && !s.thread.synced) {
                    io.sync(channel, messages, s.latest);
                    s.thread.synced = true;
                    return s;
                }
                var index = s.thread.index || 0;
                if (index < messages.length) {
                    if (candidate(messages[index], channel, c))
                        io.answer(channel, messages[index], messages);
                    s.thread.index = index + 1;
                }
                else {
                    s.thread = null;
                    s.index++;
                }
            }
        }
        else if (s.parents && s.index < s.parents.length) {
            io.clearStage();
            s.thread = {
                ts: s.parents[s.index]
            };
        }
        else if (s.parents && !s.cursor) {
            s.channel = (s.channel || 0) + 1;
            s.parents = null;
            s.index = 0;
            if (s.channel >= c.channels.length) {
                io.cycleComplete(s.latest);
                return {};
            }
        }
        else {
            var h = io.history(channel, s.cursor || '', s.latest);
            s.parents = (h.messages || []).filter(function (m) {
                return m.ts && (!m.thread_ts || m.thread_ts === m.ts) && !systemMessage(m);
            }).map(function (m) {
                return m.ts;
            });
            s.index = 0;
            s.cursor = (h.response_metadata || {}).next_cursor || '';
            if (h.has_more && !s.cursor)
                throw new Error('HISTORY_CURSOR_MISSING');
        }
        return s;
    }
    return {
        text: text, parse: parse, candidate: candidate, row: row, step: step
    };
})();
if (typeof module !== 'undefined')
    module.exports = SalesQa;
