"""再配送時の状態と、Slack送信直前の境界を管理する。"""
from dataclasses import dataclass
import time
import uuid


@dataclass
class Worker:
    store: object
    answer: object
    send: object
    alert: object

    def process(self, work):
        owner = str(uuid.uuid4())
        state = self.store.claim(work.key, owner, time.time())
        if state == "done":
            return 200
        if state == "busy":
            return 503
        if state == "uncertain":
            self.alert("送信結果を確認できない処理があります。二重送信を防ぐため自動再送を止めました。", work.key, work, "uncertain")
            return 200
        try:
            answer = self.answer(work.text)
            if not isinstance(answer, str) or not answer.strip() or len(answer) > 35000:
                raise ValueError("INVALID_ANSWER")
            # この記録後に通信切断した場合、再配送されても自動で再投稿しない。
            self.store.posting(work.key, owner, channel=work.channel, thread_ts=work.thread_ts)
            result = self.send(work, answer)
            self.store.finish(work.key, owner, "done", reply_ts=result)
            return 200
        except Exception:
            state = self.store.fail(work.key, owner)
            self.alert("回答生成に失敗しました。再試行します。" if state == "retry" else "Slackへの送信結果が不明です。自動再送を止めました。", work.key, work, state)
            return 503 if state == "retry" else 200
